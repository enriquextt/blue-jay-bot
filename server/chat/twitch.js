import { readFile, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const MAX_MESSAGE_LENGTH = 450;
const MAX_INCOMING_LENGTH = 600;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

export async function loadCredentials(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function unescapeTag(value) {
  const escapes = { s: ' ', n: '\n', r: '\r', ':': ';', '\\': '\\' };
  return value.replace(/\\(.)/g, (_, char) => escapes[char] ?? char);
}

// Convierte una línea IRC de Twitch en { tags, prefix, command, params, trailing }.
export function parseIrcLine(line) {
  let rest = line;
  const tags = {};

  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    for (const pair of rest.slice(1, end).split(';')) {
      const [key, value = ''] = pair.split('=');
      tags[key] = unescapeTag(value);
    }
    rest = rest.slice(end + 1);
  }

  let prefix = null;
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }

  let trailing = null;
  const trailingStart = rest.indexOf(' :');
  if (trailingStart !== -1) {
    trailing = rest.slice(trailingStart + 2);
    rest = rest.slice(0, trailingStart);
  }

  const [command, ...params] = rest.split(' ');
  return { tags, prefix, command, params, trailing };
}

// Mensaje normalizado para el núcleo: { platform, user, text, isMod }.
export function toChatMessage(parsed) {
  if (parsed.command !== 'PRIVMSG' || parsed.prefix === null || parsed.trailing === null) return null;
  if (parsed.trailing.length > MAX_INCOMING_LENGTH) return null;

  const user = parsed.prefix.split('!')[0];
  const badges = (parsed.tags.badges ?? '').split(',').map((badge) => badge.split('/')[0]);
  // `isMod` da acceso a los comandos de control: moderadores, propietario, VIPs y suscriptores.
  const isMod = parsed.tags.mod === '1' || parsed.tags.subscriber === '1'
    || ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder'].some((badge) => badges.includes(badge));
  return { platform: 'twitch', user, text: parsed.trailing, isMod };
}

export function createTwitchAdapter({
  credentialsPath,
  credentials,
  onMessage,
  log = () => {},
  WebSocketImpl = WebSocket,
  fetchImpl = fetch,
}) {
  const channel = credentials.channel.toLowerCase();
  const login = credentials.login.toLowerCase();
  let socket = null;
  let stopped = false;
  let attempts = 0;
  let reconnectTimer = null;
  let connected = false;

  async function refreshToken() {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.token.refresh_token,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });
    if (!response.ok) throw new Error(`refresh ${response.status}`);

    credentials.token = await response.json();
    await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`);
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    attempts += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  function say(text) {
    if (socket?.readyState !== WebSocketImpl.OPEN) return;
    const clean = String(text).replace(/[\r\n]+/g, ' ').slice(0, MAX_MESSAGE_LENGTH);
    socket.send(`PRIVMSG #${channel} :${clean}`);
  }

  async function handleLine(line) {
    const parsed = parseIrcLine(line);

    if (parsed.command === 'PING') return socket.send(`PONG :${parsed.trailing ?? 'tmi.twitch.tv'}`);
    if (parsed.command === '001') {
      attempts = 0;
      connected = true;
      return log('twitch.connected');
    }
    if (parsed.command === 'NOTICE' && parsed.trailing?.includes('authentication failed')) {
      log('twitch.authFailed');
      try {
        await refreshToken();
        log('twitch.tokenRefreshed');
      } catch (error) {
        log('twitch.refreshFailed', error);
      }
      return socket.close();
    }

    const message = toChatMessage(parsed);
    if (message) await onMessage(message, say);
  }

  function connect() {
    if (stopped) return;

    socket = new WebSocketImpl(IRC_URL);
    socket.on('open', () => {
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send(`PASS oauth:${credentials.token.access_token}`);
      socket.send(`NICK ${login}`);
      socket.send(`JOIN #${channel}`);
    });
    socket.on('message', (raw) => {
      for (const line of raw.toString().split('\r\n')) {
        if (line) handleLine(line).catch((error) => log('twitch.error', error));
      }
    });
    socket.on('close', () => {
      connected = false;
      scheduleReconnect();
    });
    socket.on('error', (error) => log('twitch.error', error));
  }

  return {
    start: connect,
    say,
    status: () => (connected ? 'connected' : 'connecting'),
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
