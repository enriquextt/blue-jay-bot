import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/app.js';

const ID_A = 'aqz-KE-bpKQ';

async function startServer() {
  const fetchTitle = async (videoId) => `Título ${videoId}`;
  const server = await createServer({ host: '127.0.0.1', port: 0, fetchTitle });
  const { port } = server.app.server.address();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    const waiters = [];

    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
      for (const waiter of waiters.splice(0)) waiter();
    });
    socket.on('open', () => resolve({ socket, messages, waitFor }));
    socket.on('error', reject);

    function waitFor(predicate) {
      return new Promise((done) => {
        const check = () => {
          const found = messages.find(predicate);
          if (found) return done(found);
          waiters.push(check);
        };
        check();
      });
    }
  });
}

const send = (client, message) => client.socket.send(JSON.stringify(message));
const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

test('el widget solo recibe el estado de la canción actual, sin lista base ni biblioteca', async () => {
  const { server, url } = await startServer();
  try {
    const panel = await connect(url);
    send(panel, { type: 'queue.add', url: `https://youtu.be/${ID_A}` });
    await panel.waitFor((m) => m.type === 'state' && m.data.current);

    const widget = await connect(`${url}?view=widget`);
    const state = await widget.waitFor((m) => m.type === 'state');
    assert.deepEqual(Object.keys(state.data.current).sort(), ['artist', 'id', 'requestedBy', 'title']);
    assert.equal(state.data.current.title, `Título ${ID_A}`);

    await pause();
    assert.deepEqual(widget.messages.map((m) => m.type), ['state']);

    panel.socket.close();
    widget.socket.close();
  } finally {
    await server.close();
  }
});

test('el widget recibe cada cambio de canción y no puede mandar órdenes', async () => {
  const { server, url } = await startServer();
  try {
    const widget = await connect(`${url}?view=widget`);
    await widget.waitFor((m) => m.type === 'state' && m.data.current === null);

    send(widget, { type: 'queue.add', url: `https://youtu.be/${ID_A}` });
    await pause();
    assert.equal(widget.messages.length, 1);

    const panel = await connect(url);
    send(panel, { type: 'queue.add', url: `https://youtu.be/${ID_A}` });
    const state = await widget.waitFor((m) => m.type === 'state' && m.data.current);
    assert.equal(state.data.current.title, `Título ${ID_A}`);

    panel.socket.close();
    widget.socket.close();
  } finally {
    await server.close();
  }
});

test('playback.progress llega al widget solo si es de la canción que suena y se valida', async () => {
  const { server, url } = await startServer();
  try {
    const panel = await connect(url);
    const widget = await connect(`${url}?view=widget`);
    send(panel, { type: 'queue.add', url: `https://youtu.be/${ID_A}` });
    const { data } = await widget.waitFor((m) => m.type === 'state' && m.data.current);
    const id = data.current.id;

    send(panel, { type: 'playback.progress', id: 'otra-cancion', position: 5, duration: 100, paused: false });
    send(panel, { type: 'playback.progress', id, position: 'x', duration: 100, paused: false });
    const error = await panel.waitFor((m) => m.type === 'error');
    assert.equal(error.key, 'errors.invalidMessage');

    send(panel, { type: 'playback.progress', id, position: 150, duration: 100, paused: true });
    const progress = await widget.waitFor((m) => m.type === 'progress');
    assert.deepEqual(progress.data, { id, position: 100, duration: 100, paused: true });
    assert.equal(widget.messages.filter((m) => m.type === 'progress').length, 1);
    assert.equal(panel.messages.some((m) => m.type === 'progress'), false);

    // Un widget que se conecta después recibe el último progreso.
    const late = await connect(`${url}?view=widget`);
    assert.deepEqual((await late.waitFor((m) => m.type === 'progress')).data, progress.data);

    panel.socket.close();
    widget.socket.close();
    late.socket.close();
  } finally {
    await server.close();
  }
});

test('widget.test envía la tarjeta de prueba solo al widget y no toca la cola', async () => {
  const { server, url } = await startServer();
  try {
    const panel = await connect(url);
    const widget = await connect(`${url}?view=widget`);

    send(panel, { type: 'widget.test' });
    const card = await widget.waitFor((m) => m.type === 'widget.test');
    assert.equal(card.data.duration, 8);

    await pause();
    assert.equal(panel.messages.some((m) => m.type === 'widget.test'), false);
    const response = await fetch(`${url.replace('ws:', 'http:').replace('/ws', '')}/api/state`);
    assert.equal((await response.json()).current, null);

    panel.socket.close();
    widget.socket.close();
  } finally {
    await server.close();
  }
});

test('mostrar el widget (!queue, !song) se envía solo a los widgets', async () => {
  const { server, url } = await startServer();
  try {
    const panel = await connect(url);
    const widget = await connect(`${url}?view=widget`);

    server.channel.showWidget();
    const show = await widget.waitFor((m) => m.type === 'widget.show');
    assert.equal(show.data.seconds, 10);

    await pause();
    assert.equal(panel.messages.some((m) => m.type === 'widget.show'), false);

    panel.socket.close();
    widget.socket.close();
  } finally {
    await server.close();
  }
});
