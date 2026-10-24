import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/app.js';

const ID_A = 'aqz-KE-bpKQ';
const ID_B = 'dQw4w9WgXcQ';

async function startServer() {
  const fetchTitle = async (videoId) => `Título ${videoId}`;
  const server = await createServer({ host: '127.0.0.1', port: 0, fetchTitle });
  const { port } = server.app.server.address();
  return { server, url: `ws://127.0.0.1:${port}/ws`, port };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    const waiters = [];

    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
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

test('GET /api/state devuelve la cola vacía al arrancar', async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.deepEqual(await response.json(), { current: null, queue: [], volume: 50 });
  } finally {
    await server.close();
  }
});

test('queue.add con un enlace válido actualiza el estado en todos los clientes', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const other = await connect(url);

    client.socket.send(JSON.stringify({ type: 'queue.add', url: `https://youtu.be/${ID_A}` }));

    const state = await other.waitFor((m) => m.type === 'state' && m.data.current);
    assert.equal(state.data.current.videoId, ID_A);
    assert.equal(state.data.current.title, `Título ${ID_A}`);

    client.socket.close();
    other.socket.close();
  } finally {
    await server.close();
  }
});

test('queue.add rechaza enlaces que no son de YouTube', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    client.socket.send(JSON.stringify({ type: 'queue.add', url: 'https://example.com/watch?v=' + ID_A }));

    const error = await client.waitFor((m) => m.type === 'error');
    assert.equal(error.key, 'errors.invalidUrl');

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('playback.unavailable salta la canción una sola vez y envía un aviso', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    client.socket.send(JSON.stringify({ type: 'queue.add', url: ID_A }));
    client.socket.send(JSON.stringify({ type: 'queue.add', url: ID_B }));

    const first = await client.waitFor((m) => m.type === 'state' && m.data.queue.length === 1);
    const currentId = first.data.current.id;

    client.socket.send(JSON.stringify({ type: 'playback.unavailable', id: currentId }));
    client.socket.send(JSON.stringify({ type: 'playback.unavailable', id: currentId }));

    const notice = await client.waitFor((m) => m.type === 'notice');
    assert.equal(notice.key, 'notices.skippedUnavailable');
    assert.equal(notice.params.title, `Título ${ID_A}`);

    const state = await client.waitFor((m) => m.type === 'state' && m.data.current?.videoId === ID_B);
    assert.deepEqual(state.data.queue, []);

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('un mensaje mal formado recibe errors.invalidMessage', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    client.socket.send('no es json');

    const error = await client.waitFor((m) => m.type === 'error');
    assert.equal(error.key, 'errors.invalidMessage');

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('playback.volume actualiza el volumen en todos los clientes y rechaza valores no válidos', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const other = await connect(url);

    client.socket.send(JSON.stringify({ type: 'playback.volume', volume: 30 }));
    const state = await other.waitFor((m) => m.type === 'state' && m.data.volume === 30);
    assert.equal(state.data.volume, 30);

    for (const volume of [101, -1, 2.5, '30']) {
      client.socket.send(JSON.stringify({ type: 'playback.volume', volume }));
    }
    // Los mensajes llegan en orden: cuando se ve el 40 válido, los 4 inválidos ya fueron rechazados.
    client.socket.send(JSON.stringify({ type: 'playback.volume', volume: 40 }));
    await client.waitFor((m) => m.type === 'state' && m.data.volume === 40);

    const errors = client.messages.filter((m) => m.type === 'error');
    assert.equal(errors.length, 4);
    assert.ok(errors.every((m) => m.key === 'errors.invalidMessage'));
    assert.ok(!client.messages.some((m) => m.type === 'state' && ![50, 30, 40].includes(m.data.volume)));

    client.socket.close();
    other.socket.close();
  } finally {
    await server.close();
  }
});
