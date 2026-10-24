import { WebSocket } from 'ws';
import { parseVideoId } from '../youtube/youtube.js';

const MAX_URL_LENGTH = 500;
const MAX_ID_LENGTH = 64;
const MAX_VOLUME = 100;

export function createChannel({ wss, queue, fetchTitle }) {
  const clients = new Set();

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  function broadcastState() {
    broadcast({ type: 'state', data: queue.snapshot() });
  }

  function sendError(socket, key) {
    send(socket, { type: 'error', key });
  }

  function isId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
  }

  async function handleCommand(socket, command) {
    switch (command?.type) {
      case 'queue.add': {
        const url = command.url;
        if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return sendError(socket, 'errors.invalidUrl');

        const videoId = parseVideoId(url);
        if (!videoId) return sendError(socket, 'errors.invalidUrl');

        const title = (await fetchTitle(videoId)) ?? videoId;
        queue.add({ videoId, title });
        return broadcastState();
      }

      case 'queue.remove': {
        if (!isId(command.id) || !queue.remove(command.id)) return sendError(socket, 'errors.trackNotFound');
        return broadcastState();
      }

      case 'queue.move': {
        if (!isId(command.id) || !Number.isInteger(command.toIndex)) return sendError(socket, 'errors.invalidMessage');
        if (!queue.move(command.id, command.toIndex)) return sendError(socket, 'errors.trackNotFound');
        return broadcastState();
      }

      case 'playback.next': {
        queue.advance();
        return broadcastState();
      }

      case 'playback.volume': {
        if (!Number.isInteger(command.volume) || command.volume < 0 || command.volume > MAX_VOLUME) {
          return sendError(socket, 'errors.invalidMessage');
        }
        queue.setVolume(command.volume);
        return broadcastState();
      }

      case 'playback.ended': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');
        if (queue.finish(command.id)) broadcastState();
        return;
      }

      case 'playback.unavailable': {
        if (!isId(command.id)) return sendError(socket, 'errors.invalidMessage');

        const { current } = queue.snapshot();
        if (!queue.finish(command.id)) return;

        broadcast({ type: 'notice', key: 'notices.skippedUnavailable', params: { title: current.title } });
        return broadcastState();
      }

      default:
        return sendError(socket, 'errors.invalidMessage');
    }
  }

  wss.on('connection', (socket) => {
    clients.add(socket);
    send(socket, { type: 'state', data: queue.snapshot() });

    socket.on('message', (raw) => {
      let command;
      try {
        command = JSON.parse(raw.toString());
      } catch {
        return sendError(socket, 'errors.invalidMessage');
      }

      handleCommand(socket, command).catch(() => sendError(socket, 'errors.serverError'));
    });

    socket.on('close', () => clients.delete(socket));
  });

  return { broadcastState };
}
