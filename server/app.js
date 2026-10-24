import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { PlaybackQueue } from './queue/playback-queue.js';
import { createChannel } from './ws/channel.js';
import { fetchVideoTitle } from './youtube/youtube.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const NODE_MODULES_DIR = join(ROOT_DIR, 'node_modules');

export async function createServer({ host, port, fetchTitle = (videoId) => fetchVideoTitle(videoId) }) {
  const app = Fastify({ logger: false });
  const queue = new PlaybackQueue();

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

  app.get('/api/state', async () => queue.snapshot());

  await app.listen({ host, port });

  const wss = new WebSocketServer({ server: app.server, path: '/ws' });
  createChannel({ wss, queue, fetchTitle });

  return {
    app,
    async close() {
      wss.close();
      await app.close();
    },
  };
}
