import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { BaseList } from './baselist/base-list.js';
import { Blacklist } from './baselist/blacklist.js';
import { createTwitchAdapter, loadCredentials } from './chat/twitch.js';
import { createCommands } from './commands/index.js';
import { createTranslator } from './i18n/index.js';
import { PlaybackQueue } from './queue/playback-queue.js';
import { createChannel } from './ws/channel.js';
import { fetchPlaylistVideos, fetchVideoTitle, searchVideoId } from './youtube/youtube.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const NODE_MODULES_DIR = join(ROOT_DIR, 'node_modules');

export async function createServer({
  host,
  port,
  language,
  voteSkipThreshold,
  twitchCredentialsPath = null,
  youtubeCredentialsPath = null,
  baseListPath = null,
  blacklistPath = null,
  log = () => {},
  fetchTitle = (videoId) => fetchVideoTitle(videoId),
}) {
  const app = Fastify({ logger: false });
  const baseList = new BaseList({ path: baseListPath, log });
  const blacklist = new Blacklist({ path: blacklistPath, log });
  await Promise.all([baseList.load(), blacklist.load()]);
  const queue = new PlaybackQueue({ fallback: () => baseList.next() });

  const withFavorite = (track) => track && { ...track, favorite: baseList.isFavorite(track.videoId) };
  const getState = () => {
    const { current, queue: pending, volume } = queue.snapshot();
    return { current: withFavorite(current), queue: pending.map(withFavorite), volume, fallback: baseList.status() };
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

  await app.listen({ host, port });

  const youtube = youtubeCredentialsPath ? await loadCredentials(youtubeCredentialsPath) : null;
  if (youtubeCredentialsPath && !youtube?.apiKey) log('youtube.searchDisabled');

  const wss = new WebSocketServer({ server: app.server, path: '/ws' });
  const channel = createChannel({
    wss,
    queue,
    baseList,
    blacklist,
    getState,
    fetchTitle,
    listPlaylist: youtube?.apiKey ? (playlistId) => fetchPlaylistVideos(playlistId, youtube.apiKey) : null,
  });

  const commands = createCommands({
    queue,
    blacklist,
    fetchTitle,
    searchVideo: youtube?.apiKey ? (query) => searchVideoId(query, youtube.apiKey) : null,
    t: await createTranslator(language),
    onChange: channel.broadcastState,
    voteSkipThreshold,
  });
  const twitch = await startTwitch({ credentialsPath: twitchCredentialsPath, commands, log });

  return {
    app,
    async close() {
      twitch?.stop();
      wss.close();
      await app.close();
      await Promise.all([baseList.flush(), blacklist.flush()]);
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
