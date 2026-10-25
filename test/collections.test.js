import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/app.js';

const ID_A = 'aqz-KE-bpKQ';
const ID_B = 'dQw4w9WgXcQ';
const ID_C = 'jNQXAC9IVRw';

async function startServer(options = {}) {
  const fetchTitle = async (videoId) => `Título ${videoId}`;
  const server = await createServer({ host: '127.0.0.1', port: 0, fetchTitle, ...options });
  const { port } = server.app.server.address();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

const sockets = new Set();

// Cierra los clientes que quedaran abiertos (por ejemplo tras una aserción fallida) para que el servidor pueda cerrar.
async function stop(server) {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  await server.close();
}

// Cliente de prueba: `ask` envía un comando y espera el primer mensaje posterior que cumpla el predicado.
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.add(socket);
    const messages = [];
    const waiters = [];

    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
      for (const waiter of waiters.splice(0)) waiter();
    });
    socket.on('error', reject);
    socket.on('open', () => resolve({
      socket,
      messages,
      send: (command) => socket.send(JSON.stringify(command)),
      ask(command, predicate) {
        const from = messages.length;
        socket.send(JSON.stringify(command));
        return new Promise((done) => {
          const check = () => {
            const found = messages.slice(from).find(predicate);
            if (found) return done(found);
            waiters.push(check);
          };
          check();
        });
      },
    }));
  });
}

// Añade una canción y espera a que el servidor la haya puesto en la cola (el título se resuelve de forma asíncrona).
const add = (client, id) => client.ask({ type: 'queue.add', url: id }, (m) => m.type === 'state');
const history = (client, kind, filters = {}) => client.ask(
  { type: 'history.query', kind, ...filters },
  (m) => m.type === 'history.results' && m.kind === kind,
);
const playlistsOf = (client, command) => client.ask(command, (m) => m.type === 'playlists');
const errorOf = (client, command) => client.ask(command, (m) => m.type === 'error').then((m) => m.key);

test('cada canción que empieza a sonar queda en el historial de reproducción', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    await add(client, ID_A);
    await add(client, ID_B);
    client.send({ type: 'playback.next' });

    const { items, total } = await history(client, 'plays');
    assert.equal(total, 2);
    assert.deepEqual(items.map((item) => item.track.videoId), [ID_B, ID_A]);
    assert.equal(items[0].origin, 'request');

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('una petición del chat, aunque se rechace, aparece en el historial con su resultado', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const say = (text) => server.commands.handle({ platform: 'twitch', user: 'ana', text, isMod: false });
    await say(`!sr ${ID_A}`);
    await say('!sr https://example.com/malo');

    const { items } = await history(client, 'requests');
    assert.deepEqual(items.map((item) => item.outcome), ['invalid_url', 'accepted']);
    assert.equal(items[0].input, 'https://example.com/malo');
    assert.equal(items[0].track, null);

    const invalid = await history(client, 'requests', { outcome: 'invalid_url', user: 'AN' });
    assert.equal(invalid.total, 1);

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('history.delete y history.clear borran y avisan a todos los paneles', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const other = await connect(url);
    await add(client, ID_A);
    await add(client, ID_B);
    client.send({ type: 'playback.next' });
    const { items } = await history(client, 'plays');

    const changed = other.ask({ type: 'history.delete', kind: 'plays', id: items[0].id }, (m) => m.type === 'history.changed');
    await changed;
    assert.equal((await history(client, 'plays')).total, 1);

    assert.equal(await errorOf(client, { type: 'history.delete', kind: 'plays', id: items[0].id }), 'errors.trackNotFound');

    await other.ask({ type: 'history.clear', kind: 'plays' }, (m) => m.type === 'history.changed');
    assert.equal((await history(client, 'plays')).total, 0);

    client.socket.close();
    other.socket.close();
  } finally {
    await stop(server);
  }
});

test('history.query y history.clear rechazan datos no válidos', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);

    for (const command of [
      { type: 'history.query', kind: 'otros' },
      { type: 'history.query', kind: 'plays', outcome: 'inventado' },
      { type: 'history.query', kind: 'plays', from: 'ayer' },
      { type: 'history.query', kind: 'plays', user: 'x'.repeat(100) },
      { type: 'history.query', kind: 'plays', offset: -1 },
      { type: 'history.clear', kind: 'todo' },
      { type: 'history.delete', kind: 'plays', id: 'uno' },
    ]) {
      assert.equal(await errorOf(client, command), 'errors.invalidMessage', JSON.stringify(command));
    }

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('history.queue vuelve a poner en la cola una canción del historial', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    await add(client, ID_A);
    const { items } = await history(client, 'plays');
    await client.ask({ type: 'playback.next' }, (m) => m.type === 'state');

    const state = await client.ask({ type: 'history.queue', kind: 'plays', id: items[0].id }, (m) => m.type === 'state');
    assert.equal(state.data.current.videoId, ID_A);

    client.send({ type: 'ban.add', id: state.data.current.id });
    assert.equal(await errorOf(client, { type: 'history.queue', kind: 'plays', id: items[0].id }), 'errors.trackBanned');

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('settings.update cambia los ajustes para todos y desactivar las peticiones frena el chat', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const other = await connect(url);
    const say = (text) => server.commands.handle({ platform: 'twitch', user: 'ana', text, isMod: false });

    const settings = other.ask({ type: 'settings.update', chatEnabled: false }, (m) => m.type === 'settings');
    assert.equal((await settings).data.chatEnabled, false);
    assert.match(await say(`!sr ${ID_A}`), /desactivadas/);
    assert.equal((await history(client, 'requests')).items[0].outcome, 'disabled');

    await client.ask({ type: 'settings.update', chatEnabled: true, limits: { user: { max: 1 } } }, (m) => m.type === 'settings');
    assert.match(await say(`!sr ${ID_A}`), /suena ahora/);
    assert.match(await say(`!sr ${ID_B}`), /ya tienes 1 petición activa/);

    assert.equal(await errorOf(client, { type: 'settings.update', limits: { user: { max: 0 } } }), 'errors.invalidMessage');

    client.socket.close();
    other.socket.close();
  } finally {
    await stop(server);
  }
});

test('queue.clear vacía las pendientes y deja sonando la actual', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    await add(client, ID_A);
    await add(client, ID_B);
    await add(client, ID_C);

    const state = await client.ask({ type: 'queue.clear' }, (m) => m.type === 'state' && m.data.queue.length === 0);
    assert.equal(state.data.current.videoId, ID_A);

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('las listas se crean, se llenan desde el historial y se añaden a la cola', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const say = (user, text) => server.commands.handle({ platform: 'twitch', user, text, isMod: false });
    await say('ana', `!sr ${ID_A}`);
    await say('bea', `!sr ${ID_B}`);
    await say('bea', '!sr https://example.com/malo');

    const created = await client.ask({ type: 'playlist.create', name: ' Favoritas del chat ' }, (m) => m.type === 'playlist.created');
    const { items: requests } = await history(client, 'requests');
    const [invalid, second, first] = requests;

    const save = (item) => client.ask(
      { type: 'playlist.addFromHistory', id: created.id, kind: 'requests', itemId: item.id },
      (m) => m.type === 'notice',
    );
    assert.equal((await save(first)).key, 'notices.savedToPlaylist');
    assert.equal((await save(second)).key, 'notices.savedToPlaylist');
    assert.equal((await save(first)).key, 'notices.alreadyInPlaylist');
    assert.equal(await errorOf(client, { type: 'playlist.addFromHistory', id: created.id, kind: 'requests', itemId: invalid.id }), 'errors.trackNotFound');

    const summary = client.messages.findLast((m) => m.type === 'playlists');
    assert.deepEqual(summary.data, [{ id: created.id, name: 'Favoritas del chat', count: 2 }]);

    const opened = await client.ask({ type: 'playlist.open', id: created.id }, (m) => m.type === 'playlist');
    assert.deepEqual(opened.data.items.map((item) => item.videoId), [ID_A, ID_B]);

    // Se vacía la cola y se vuelve a llenar desde la lista.
    await client.ask({ type: 'playback.next' }, (m) => m.type === 'state');
    await client.ask({ type: 'playback.next' }, (m) => m.type === 'state' && m.data.current === null);

    const one = await client.ask({ type: 'playlist.queueItem', itemId: opened.data.items[1].id }, (m) => m.type === 'state');
    assert.equal(one.data.current.videoId, ID_B);

    const all = await client.ask({ type: 'playlist.queueAll', id: created.id }, (m) => m.type === 'notice');
    assert.deepEqual(all.params, { name: 'Favoritas del chat', added: 2, total: 2 });

    const state = await client.ask({ type: 'queue.clear' }, (m) => m.type === 'state');
    assert.equal(state.data.queue.length, 0);

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('playlist.queueAll se salta las canciones vetadas', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const created = await client.ask({ type: 'playlist.create', name: 'Mix' }, (m) => m.type === 'playlist.created');

    await add(client, ID_A);
    const state = await client.ask({ type: 'queue.clear' }, (m) => m.type === 'state');
    await client.ask({ type: 'playlist.addTrack', id: created.id, trackId: state.data.current.id }, (m) => m.type === 'notice');
    await client.ask({ type: 'ban.add', id: state.data.current.id }, (m) => m.type === 'baselist');

    const notice = await client.ask({ type: 'playlist.queueAll', id: created.id }, (m) => m.key === 'notices.playlistQueued');
    assert.deepEqual(notice.params, { name: 'Mix', added: 0, total: 1 });
    assert.equal(await errorOf(client, { type: 'playlist.queueItem', itemId: 1 }), 'errors.trackBanned');

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('playlist.saveQueue guarda la canción actual y la cola en una lista nueva', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    assert.equal(await errorOf(client, { type: 'playlist.saveQueue', name: 'Vacía' }), 'errors.queueEmpty');

    await add(client, ID_A);
    await add(client, ID_B);
    const state = await client.ask({ type: 'queue.clear' }, (m) => m.type === 'state' && m.data.queue.length === 0);
    assert.equal(state.data.current.videoId, ID_A);
    await add(client, ID_C);
    await add(client, ID_B);

    const notice = await client.ask({ type: 'playlist.saveQueue', name: 'Sesión' }, (m) => m.key === 'notices.savedToPlaylist');
    assert.deepEqual(notice.params, { name: 'Sesión', added: 3 });

    assert.equal(await errorOf(client, { type: 'playlist.saveQueue', name: '  ' }), 'errors.playlistInvalid');

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('renombrar, quitar una pista y eliminar una lista, y los errores de listas que no existen', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const { id } = await client.ask({ type: 'playlist.create', name: 'Vieja' }, (m) => m.type === 'playlist.created');

    await add(client, ID_A);
    const state = await client.ask({ type: 'queue.clear' }, (m) => m.type === 'state');
    await client.ask({ type: 'playlist.addTrack', id, trackId: state.data.current.id }, (m) => m.type === 'notice');

    const renamed = await playlistsOf(client, { type: 'playlist.rename', id, name: 'Nueva' });
    assert.deepEqual(renamed.data, [{ id, name: 'Nueva', count: 1 }]);

    const opened = await client.ask({ type: 'playlist.open', id }, (m) => m.type === 'playlist');
    const removed = await playlistsOf(client, { type: 'playlist.removeItem', itemId: opened.data.items[0].id });
    assert.equal(removed.data[0].count, 0);

    assert.deepEqual((await playlistsOf(client, { type: 'playlist.remove', id })).data, []);
    assert.equal(await errorOf(client, { type: 'playlist.open', id }), 'errors.playlistNotFound');
    assert.equal(await errorOf(client, { type: 'playlist.remove', id }), 'errors.playlistNotFound');
    assert.equal(await errorOf(client, { type: 'playlist.queueAll', id }), 'errors.playlistNotFound');
    assert.equal(await errorOf(client, { type: 'playlist.addTrack', id, trackId: 'no-existe' }), 'errors.trackNotFound');
    assert.equal(await errorOf(client, { type: 'playlist.create', name: '' }), 'errors.playlistInvalid');
    assert.equal(await errorOf(client, { type: 'playlist.open', id: 'x' }), 'errors.invalidMessage');

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('la cola, el volumen, los ajustes, el historial y las listas sobreviven a un reinicio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluejay-'));
  const databasePath = join(dir, 'data', 'blue-jay.db');
  try {
    let { server, url } = await startServer({ databasePath });
    let client = await connect(url);

    await add(client, ID_A);
    await add(client, ID_B);
    await add(client, ID_C);
    client.send({ type: 'playback.volume', volume: 70 });
    client.send({ type: 'settings.update', chatEnabled: false, limits: { global: { max: 7 } } });
    const created = await client.ask({ type: 'playlist.create', name: 'Guardada' }, (m) => m.type === 'playlist.created');
    const before = (await client.ask({ type: 'playback.next' }, (m) => m.type === 'state' && m.data.current?.videoId === ID_B)).data;
    client.socket.close();
    await stop(server);

    ({ server, url } = await startServer({ databasePath }));
    client = await connect(url);

    const restored = await client.ask({ type: 'queue.add', url: ID_A }, (m) => m.type === 'state');
    assert.equal(restored.data.current.videoId, before.current.videoId);
    assert.deepEqual(restored.data.queue.map((track) => track.videoId), [ID_C, ID_A]);
    assert.equal(restored.data.volume, 70);

    assert.equal(client.messages.find((m) => m.type === 'settings').data.chatEnabled, false);
    assert.equal(client.messages.find((m) => m.type === 'settings').data.limits.global.max, 7);
    assert.deepEqual(client.messages.find((m) => m.type === 'playlists').data, [{ id: created.id, name: 'Guardada', count: 0 }]);
    // Recuperar la canción actual al arrancar no cuenta como una reproducción nueva.
    assert.equal((await history(client, 'plays')).total, 2);

    client.socket.close();
    await stop(server);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('el estado de la lista base (START / SHUFFLE) se recupera tras un reinicio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluejay-'));
  const databasePath = join(dir, 'blue-jay.db');
  const baseListPath = join(dir, 'baselist.json');
  const sync = (client) => client.ask({ type: 'playback.volume', volume: 50 }, (m) => m.type === 'state');
  try {
    let { server, url } = await startServer({ databasePath, baseListPath });
    let client = await connect(url);
    await client.ask({ type: 'baselist.add', url: ID_A }, (m) => m.type === 'baselist');
    client.send({ type: 'baselist.start', mode: 'shuffle' });
    await sync(client);
    client.socket.close();
    await stop(server);

    ({ server, url } = await startServer({ databasePath, baseListPath }));
    client = await connect(url);
    const { data } = await sync(client);
    assert.deepEqual(data.fallback, { active: true, mode: 'shuffle', includeLibrary: false });
    assert.equal(data.current.videoId, ID_A);
    assert.equal(data.current.origin, 'base');

    client.socket.close();
    await stop(server);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('los mensajes del bot se editan, se desactivan y se restauran desde el panel', async () => {
  const { server, url } = await startServer({ language: 'es' });
  try {
    const client = await connect(url);
    const other = await connect(url);
    const say = (text) => server.commands.handle({ platform: 'twitch', user: 'ana', text, isMod: false });
    const isMessages = (m) => m.type === 'messages';

    const initial = await client.ask({ type: 'playback.volume', volume: 50 }, (m) => m.type === 'state').then(() => client.messages.find(isMessages));
    assert.equal(initial.data.language, 'es');
    assert.ok(initial.data.items.some((item) => item.key === 'chat.sr.banned'));

    const edited = await other.ask(
      { type: 'message.setText', locale: 'es', leaf: 'chat.sr.usage', text: 'Pide con !sr, @{{user}}' },
      isMessages,
    );
    assert.equal(edited.data.items.find((item) => item.key === 'chat.sr.usage').forms[0].custom.es, 'Pide con !sr, @{{user}}');
    assert.equal(await say('!sr'), 'Pide con !sr, @ana');

    await client.ask({ type: 'message.setEnabled', key: 'chat.sr.usage', enabled: false }, isMessages);
    assert.equal(await say('!sr'), null);

    assert.equal(await errorOf(client, { type: 'message.setText', locale: 'es', leaf: 'chat.sr.usage', text: '{{inventada}}' }), 'errors.messageInvalid');
    assert.equal(await errorOf(client, { type: 'message.setText', locale: 'fr', leaf: 'chat.sr.usage', text: 'x' }), 'errors.invalidMessage');
    assert.equal(await errorOf(client, { type: 'message.setEnabled', key: 'chat.no.existe', enabled: true }), 'errors.invalidMessage');
    assert.equal(await errorOf(client, { type: 'message.reset', key: 'chat.no.existe' }), 'errors.invalidMessage');

    await client.ask({ type: 'message.reset', key: 'chat.sr.usage' }, isMessages);
    assert.match(await say('!sr'), /usa !sr seguido de un enlace/);

    client.socket.close();
    other.socket.close();
  } finally {
    await stop(server);
  }
});

test('un mensaje desactivado no impide anotar la petición en el historial', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    await client.ask({ type: 'message.setEnabled', key: 'chat.sr.invalid', enabled: false }, (m) => m.type === 'messages');

    const reply = await server.commands.handle({ platform: 'twitch', user: 'ana', text: '!sr https://example.com/malo', isMod: false });
    assert.equal(reply, null);
    assert.equal((await history(client, 'requests')).items[0].outcome, 'invalid_url');

    client.socket.close();
  } finally {
    await stop(server);
  }
});

test('los mensajes personalizados sobreviven a un reinicio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluejay-'));
  const databasePath = join(dir, 'blue-jay.db');
  try {
    let { server, url } = await startServer({ databasePath });
    let client = await connect(url);
    await client.ask({ type: 'message.setText', locale: 'es', leaf: 'chat.sr.banned', text: 'Esa no, @{{user}}' }, (m) => m.type === 'messages');
    await client.ask({ type: 'message.setEnabled', key: 'chat.skip.nothing', enabled: false }, (m) => m.type === 'messages');
    client.socket.close();
    await stop(server);

    ({ server, url } = await startServer({ databasePath }));
    client = await connect(url);
    await client.ask({ type: 'playback.volume', volume: 50 }, (m) => m.type === 'state');
    const { items } = client.messages.find((m) => m.type === 'messages').data;
    assert.equal(items.find((item) => item.key === 'chat.sr.banned').forms[0].custom.es, 'Esa no, @{{user}}');
    assert.equal(items.find((item) => item.key === 'chat.skip.nothing').enabled, false);

    client.socket.close();
    await stop(server);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Servidor con una biblioteca de una sola pista local (Rick Astley) y un vídeo que no se puede reproducir.
async function startWithLibrary(options = {}) {
  const base = await mkdtemp(join(tmpdir(), 'bluejay-fallback-'));
  const music = join(base, 'musica');
  await mkdir(music);
  await writeFile(join(music, 'pista.mp3'), 'datos');

  const running = await startServer({
    libraryConfigPath: join(base, 'library.json'),
    watchLibrary: false,
    readTags: async () => ({ title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: null, notes: [], duration: 213 }),
    fetchTitle: async () => null,
    fetchInfo: async () => ({ title: 'Rick Astley - Never Gonna Give You Up (Official Video)', embeddable: false }),
    ...options,
  });
  const client = await connect(running.url);
  await client.ask(
    { type: 'library.setFolder', path: music },
    (m) => m.type === 'library' && m.data.status === 'ready' && m.data.count === 1,
  );
  return { ...running, client, base };
}

test('una petición de YouTube que no se puede reproducir se sustituye por su pista local', async () => {
  const { server, client, base } = await startWithLibrary();
  try {
    const { data } = await add(client, ID_A);
    assert.equal(data.current.title, ID_A);

    const replaced = await client.ask({ type: 'playback.unavailable', id: data.current.id }, (m) => m.type === 'state');
    assert.equal(replaced.data.current.source, 'local');
    assert.equal(replaced.data.current.title, 'Never Gonna Give You Up');
    assert.equal(replaced.data.current.origin, 'request');
    assert.notEqual(replaced.data.current.id, data.current.id);

    const notice = client.messages.find((m) => m.key === 'notices.replacedByLocal');
    assert.deepEqual(notice.params, { title: ID_A, replacement: 'Rick Astley - Never Gonna Give You Up' });
  } finally {
    await stop(server);
    await rm(base, { recursive: true, force: true });
  }
});

test('con el interruptor apagado, una petición que no se puede reproducir solo se salta', async () => {
  const { server, client, base } = await startWithLibrary();
  try {
    await client.ask({ type: 'settings.update', localFallback: false }, (m) => m.type === 'settings');
    const { data } = await add(client, ID_A);

    const skipped = await client.ask({ type: 'playback.unavailable', id: data.current.id }, (m) => m.type === 'state');
    assert.equal(skipped.data.current, null);
    assert.equal(client.messages.some((m) => m.key === 'notices.replacedByLocal'), false);
  } finally {
    await stop(server);
    await rm(base, { recursive: true, force: true });
  }
});

test('una pista de la lista base que no se puede reproducir no se sustituye', async () => {
  const { server, client, base } = await startWithLibrary();
  try {
    await client.ask({ type: 'baselist.add', url: ID_B }, (m) => m.type === 'baselist');
    const started = await client.ask({ type: 'baselist.start', mode: 'sequential' }, (m) => m.type === 'state');
    assert.equal(started.data.current.origin, 'base');

    const next = await client.ask({ type: 'playback.unavailable', id: started.data.current.id }, (m) => m.type === 'state');
    assert.notEqual(next.data.current?.source, 'local');
    assert.equal(client.messages.some((m) => m.key === 'notices.replacedByLocal'), false);
  } finally {
    await stop(server);
    await rm(base, { recursive: true, force: true });
  }
});

test('un enlace por chat de un vídeo que no se puede incrustar suena en su versión local', async () => {
  const { server, client, base } = await startWithLibrary();
  try {
    const reply = await server.commands.handle({ platform: 'twitch', user: 'ana', text: `!sr ${ID_A}`, isMod: false });
    assert.match(reply, /suena la versión local/);

    const { items } = await history(client, 'requests');
    assert.equal(items[0].outcome, 'replaced');
    assert.equal(items[0].track.source, 'local');
  } finally {
    await stop(server);
    await rm(base, { recursive: true, force: true });
  }
});
