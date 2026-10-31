import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { BaseList } from './baselist/base-list.js';
import { Blacklist } from './baselist/blacklist.js';
import { createTwitchAdapter, loadCredentials } from './chat/twitch.js';
import { createCommands } from './commands/index.js';
import { openDatabase } from './db/database.js';
import { createKv } from './db/kv.js';
import { History } from './history/history.js';
import { createTranslator, LOCALES, loadLocales } from './i18n/index.js';
import { Messages } from './i18n/messages.js';
import { Library } from './library/library.js';
import { Playlists } from './playlists/playlists.js';
import { PlaybackQueue } from './queue/playback-queue.js';
import { Settings } from './settings/settings.js';
import { PlayerState } from './state/player-state.js';
import { trackKey } from './tracks.js';
import { createChannel } from './ws/channel.js';
import { fetchPlaylistVideos, fetchVideoInfo, fetchVideoTitle, searchVideoId } from './youtube/youtube.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const NODE_MODULES_DIR = join(ROOT_DIR, 'node_modules');
const SAVE_DELAY_MS = 300;

export async function createServer({
  host,
  port,
  language,
  voteSkipThreshold,
  twitchCredentialsPath = null,
  youtubeCredentialsPath = null,
  baseListPath = null,
  blacklistPath = null,
  libraryConfigPath = null,
  databasePath = null,
  watchLibrary = true,
  readTags,
  log = () => {},
  fetchTitle = (videoId) => fetchVideoTitle(videoId),
  fetchInfo = null,
}) {
  const app = Fastify({ logger: false });
  const { version } = JSON.parse(await readFile(join(ROOT_DIR, 'package.json'), 'utf8'));
  const blacklist = new Blacklist({ path: blacklistPath, log });
  const library = new Library({ configPath: libraryConfigPath, log, watch: watchLibrary, readTags });
  const baseList = new BaseList({ path: baseListPath, log, library, isBanned: (key) => blacklist.hasKey(key) });
  await Promise.all([baseList.load(), blacklist.load(), library.load()]);

  // Sin `databasePath` la base de datos vive en memoria (pruebas).
  const db = openDatabase(databasePath);
  const kv = createKv(db);
  const settings = new Settings({ kv });
  const history = new History({ db });
  const playlists = new Playlists({ db });
  const playerState = new PlayerState({ kv });
  const locales = await loadLocales();
  const messages = new Messages({ kv, locales });

  const queue = new PlaybackQueue({
    fallback: () => baseList.next(),
    onPlay: (track) => {
      try {
        history.logPlay(track);
      } catch (error) {
        log('history.writeFailed', error);
      }
    },
  });

  // Recupera lo que había al cerrar: lista base, cola, canción actual y volumen.
  const saved = playerState.load();
  if (saved) {
    baseList.setIncludeLibrary(saved.fallback.includeLibrary);
    if (saved.fallback.active) baseList.start(saved.fallback.mode);
    queue.restore(saved);
    if (!queue.snapshot().current) queue.advance();
  }

  let saveTimer = null;
  const saveState = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      playerState.save({ ...queue.snapshot(), fallback: baseList.status() });
    } catch (error) {
      log('state.saveFailed', error);
    }
  };
  const scheduleSave = () => {
    saveTimer ??= setTimeout(saveState, SAVE_DELAY_MS);
  };

  const withFavorite = (track) => track && { ...track, favorite: baseList.isFavorite(trackKey(track)) };
  const getState = () => {
    const { current, queue: pending, volume, paused } = queue.snapshot();
    return { current: withFavorite(current), queue: pending.map(withFavorite), volume, paused, fallback: baseList.status() };
  };

  await app.register(fastifyStatic, { root: PUBLIC_DIR });
  await app.register(fastifyStatic, {
    root: join(NODE_MODULES_DIR, 'i18next', 'dist', 'umd'),
    prefix: '/vendor/i18next/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: join(NODE_MODULES_DIR, 'sortablejs'),
    prefix: '/vendor/sortablejs/',
    decorateReply: false,
  });

  app.get('/api/state', async () => getState());
  app.get('/api/baselist', async () => ({ items: baseList.list(), banned: blacklist.list() }));

  // El cliente solo conoce el id de la pista; la ruta sale del índice del servidor.
  app.get('/media/:id', async (request, reply) => {
    const relPath = await library.resolve(request.params.id);
    if (!relPath) return reply.code(404).send();
    return reply.sendFile(relPath, library.root);
  });

  await app.listen({ host, port });

  const youtube = youtubeCredentialsPath ? await loadCredentials(youtubeCredentialsPath) : null;
  if (youtubeCredentialsPath && !youtube?.apiKey) log('youtube.searchDisabled');

  // Datos de un vídeo (título y si se puede incrustar): solo con la clave de YouTube, o inyectados en las pruebas.
  const getVideoInfo = fetchInfo ?? (youtube?.apiKey ? (videoId) => fetchVideoInfo(videoId, youtube.apiKey) : null);
  const t = await createTranslator(language, { locales, messages });
  let twitch = null;

  const wss = new WebSocketServer({ server: app.server, path: '/ws' });
  const channel = createChannel({
    wss,
    queue,
    baseList,
    blacklist,
    library,
    history,
    playlists,
    settings,
    messages,
    language: LOCALES.includes(language) ? language : 'es',
    getState,
    fetchTitle,
    getVideoInfo,
    t,
    announce: (text) => twitch?.say(text),
    onStateChange: scheduleSave,
    // Estado de lo que no cambia en el panel: nada de claves, rutas ni credenciales, solo si existen.
    getDiagnostics: () => ({
      version,
      uptime: Math.round(process.uptime()),
      youtubeKey: Boolean(youtube?.apiKey),
      twitch: twitch?.status() ?? 'disabled',
    }),
    listPlaylist: youtube?.apiKey ? (playlistId) => fetchPlaylistVideos(playlistId, youtube.apiKey) : null,
  });

  const commands = createCommands({
    queue,
    blacklist,
    library,
    settings,
    history,
    fetchTitle,
    searchVideo: youtube?.apiKey ? (query) => searchVideoId(query, youtube.apiKey) : null,
    getVideoInfo,
    t,
    onChange: channel.broadcastState,
    onShowWidget: channel.showWidget,
    voteSkipThreshold,
  });
  twitch = await startTwitch({ credentialsPath: twitchCredentialsPath, commands, log });

  return {
    app,
    library,
    history,
    commands,
    channel,
    async close() {
      twitch?.stop();
      library.close();
      wss.close();
      await app.close();
      await Promise.all([baseList.flush(), blacklist.flush(), library.flush()]);
      saveState();
      db.close();
    },
  };
}

async function startTwitch({ credentialsPath, commands, log }) {
  if (!credentialsPath) return null;

  const credentials = await loadCredentials(credentialsPath);
  if (!credentials?.channel || !credentials.login || !credentials.token?.access_token) {
    log('twitch.disabled');
    return null;
  }

  const twitch = createTwitchAdapter({
    credentialsPath,
    credentials,
    log,
    onMessage: async (message, say) => {
      const reply = await commands.handle(message);
      if (reply) say(reply);
    },
  });
  twitch.start();
  return twitch;
}
