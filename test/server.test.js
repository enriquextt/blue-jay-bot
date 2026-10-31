import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/app.js';

const ID_A = 'aqz-KE-bpKQ';
const ID_B = 'dQw4w9WgXcQ';

async function startServer(options = {}) {
  const fetchTitle = async (videoId) => `Título ${videoId}`;
  const server = await createServer({ host: '127.0.0.1', port: 0, fetchTitle, ...options });
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
    assert.deepEqual(await response.json(), {
      current: null,
      queue: [],
      volume: 50,
      paused: false,
      fallback: { active: false, mode: 'sequential', includeLibrary: false },
    });
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

test('playback.pause pausa y reanuda para todos los paneles, se rearma al cambiar de pista y rechaza valores no válidos', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const other = await connect(url);

    // Sin nada sonando no hay qué pausar.
    client.socket.send(JSON.stringify({ type: 'playback.pause', paused: true }));
    client.socket.send(JSON.stringify({ type: 'queue.add', url: ID_A }));
    client.socket.send(JSON.stringify({ type: 'queue.add', url: ID_B }));
    await other.waitFor((m) => m.type === 'state' && m.data.queue.length === 1);
    assert.ok(other.messages.every((m) => m.type !== 'state' || m.data.paused === false));

    client.socket.send(JSON.stringify({ type: 'playback.pause', paused: true }));
    assert.equal((await other.waitFor((m) => m.type === 'state' && m.data.paused)).data.current.videoId, ID_A);

    client.socket.send(JSON.stringify({ type: 'playback.pause', paused: 'sí' }));
    assert.equal((await client.waitFor((m) => m.type === 'error')).key, 'errors.invalidMessage');

    client.socket.send(JSON.stringify({ type: 'playback.pause', paused: false }));
    const pausedAt = other.messages.findIndex((m) => m.type === 'state' && m.data.paused);
    await other.waitFor((m) => m.type === 'state' && !m.data.paused && other.messages.indexOf(m) > pausedAt);

    // Pasar a la siguiente pista con la actual en pausa vuelve a sonar.
    client.socket.send(JSON.stringify({ type: 'playback.pause', paused: true }));
    client.socket.send(JSON.stringify({ type: 'playback.next' }));
    const next = await other.waitFor((m) => m.type === 'state' && m.data.current?.videoId === ID_B);
    assert.equal(next.data.paused, false);

    client.socket.close();
    other.socket.close();
  } finally {
    await server.close();
  }
});

test('diagnostics.get responde solo al que pregunta, con el recuento de paneles y widgets y sin claves ni rutas', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    const other = await connect(url);
    const widget = await connect(`${url}?view=widget`);

    client.socket.send(JSON.stringify({ type: 'diagnostics.get' }));
    const { data } = await client.waitFor((m) => m.type === 'diagnostics');

    assert.deepEqual(Object.keys(data).sort(), ['panels', 'twitch', 'uptime', 'version', 'widgets', 'youtubeKey']);
    assert.equal(data.panels, 2);
    assert.equal(data.widgets, 1);
    assert.equal(data.youtubeKey, false);
    assert.equal(data.twitch, 'disabled');
    assert.match(data.version, /^\d+\.\d+\.\d+/);
    assert.ok(Number.isInteger(data.uptime) && data.uptime >= 0);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(other.messages.some((m) => m.type === 'diagnostics'), false);
    assert.equal(widget.messages.some((m) => m.type === 'diagnostics'), false);

    client.socket.close();
    other.socket.close();
    widget.socket.close();
  } finally {
    await server.close();
  }
});

const send = (client, message) => client.socket.send(JSON.stringify(message));
const hasItems = (count) => (m) => m.type === 'baselist' && m.data.items.length === count;

test('baselist.add añade pistas sin duplicados y START reproduce la lista base al quedar libre', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    send(client, { type: 'baselist.add', url: ID_A });
    send(client, { type: 'baselist.add', url: `https://youtu.be/${ID_B}` });
    send(client, { type: 'baselist.add', url: ID_B });
    const list = await client.waitFor(hasItems(2));
    assert.deepEqual(list.data.items.map((item) => item.videoId), [ID_A, ID_B]);

    send(client, { type: 'baselist.start', mode: 'sequential' });
    const playing = await client.waitFor((m) => m.type === 'state' && m.data.current?.origin === 'base');
    assert.equal(playing.data.current.videoId, ID_A);
    assert.deepEqual(playing.data.fallback, { active: true, mode: 'sequential', includeLibrary: false });

    send(client, { type: 'playback.ended', id: playing.data.current.id });
    await client.waitFor((m) => m.type === 'state' && m.data.current?.videoId === ID_B);

    send(client, { type: 'baselist.stop' });
    await client.waitFor((m) => m.type === 'state' && !m.data.fallback.active);

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('baselist.start con un modo no válido, un enlace inválido o una playlist sin clave devuelven error', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    send(client, { type: 'baselist.start', mode: 'caos' });
    send(client, { type: 'baselist.add', url: 'https://example.com/x' });
    send(client, { type: 'baselist.add', url: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' });

    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.apiKeyMissing');
    const keys = client.messages.filter((m) => m.type === 'error').map((m) => m.key);
    assert.deepEqual(keys, ['errors.invalidMessage', 'errors.invalidUrl', 'errors.apiKeyMissing']);

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('favorite.set marca la canción actual y la añade a la lista base', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    send(client, { type: 'queue.add', url: ID_A });
    const playing = await client.waitFor((m) => m.type === 'state' && m.data.current);
    assert.equal(playing.data.current.favorite, false);

    send(client, { type: 'favorite.set', id: playing.data.current.id, favorite: true });
    const state = await client.waitFor((m) => m.type === 'state' && m.data.current?.favorite === true);
    assert.equal(state.data.current.videoId, ID_A);

    const list = await client.waitFor(hasItems(1));
    assert.equal(list.data.items[0].favorite, true);

    send(client, { type: 'favorite.set', id: 'no-existe', favorite: true });
    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.trackNotFound');

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('ban.add veta la canción: sale de la cola y de la lista base y no se puede volver a pedir', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    send(client, { type: 'baselist.add', url: ID_B });
    send(client, { type: 'queue.add', url: ID_A });
    send(client, { type: 'queue.add', url: ID_B });
    const queued = await client.waitFor((m) => m.type === 'state' && m.data.queue.length === 1);

    send(client, { type: 'ban.add', id: queued.data.queue[0].id });
    const notice = await client.waitFor((m) => m.type === 'notice' && m.key === 'notices.banned');
    assert.equal(notice.params.title, `Título ${ID_B}`);

    const state = await client.waitFor((m) => m.type === 'state' && m.data.queue.length === 0 && m.data.current?.videoId === ID_A);
    assert.equal(state.data.current.videoId, ID_A);
    const list = await client.waitFor((m) => m.type === 'baselist' && m.data.banned.length === 1);
    assert.deepEqual(list.data.items, []);

    send(client, { type: 'queue.add', url: ID_B });
    send(client, { type: 'baselist.add', url: ID_B });
    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.trackBanned');

    send(client, { type: 'ban.remove', key: `youtube:${ID_B}` });
    await client.waitFor((m) => m.type === 'baselist' && m.data.banned.length === 0);

    client.socket.close();
  } finally {
    await server.close();
  }
});

test('una pista de la lista base no disponible se retira de la lista', async () => {
  const { server, url } = await startServer();
  try {
    const client = await connect(url);
    send(client, { type: 'baselist.add', url: ID_A });
    await client.waitFor(hasItems(1));
    send(client, { type: 'baselist.start', mode: 'sequential' });
    const playing = await client.waitFor((m) => m.type === 'state' && m.data.current?.origin === 'base');

    send(client, { type: 'playback.unavailable', id: playing.data.current.id });
    await client.waitFor(hasItems(0));

    client.socket.close();
  } finally {
    await server.close();
  }
});

// Servidor con una carpeta de música de prueba ya indexada.
async function startLibraryServer() {
  const base = await mkdtemp(join(tmpdir(), 'bluejay-server-'));
  const music = join(base, 'musica');
  await mkdir(music);
  await writeFile(join(music, 'Artista Uno - Canción A.mp3'), 'ABCDEFGHIJ');
  await writeFile(join(music, 'Artista Dos - Tema B.flac'), 'bbbb');
  await mkdir(join(music, 'Rock'));
  await writeFile(join(music, 'Rock', '100% real #1.mp3'), '0123456789');
  await writeFile(join(base, 'secreto.mp3'), 'secreto');

  const running = await startServer({ libraryConfigPath: join(base, 'library.json'), watchLibrary: false });
  const client = await connect(running.url);
  const ready = (count) => (m) => m.type === 'library' && m.data.status === 'ready' && m.data.count === count;

  send(client, { type: 'library.setFolder', path: music });
  await client.waitFor(ready(3));

  const search = async (query) => {
    const before = client.messages.length;
    send(client, { type: 'library.search', query });
    const found = await client.waitFor((m) => m.type === 'library.results' && m.query === query
      && client.messages.indexOf(m) >= before);
    return found;
  };

  return {
    ...running,
    client,
    search,
    music,
    async cleanup() {
      client.socket.close();
      await running.server.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}

test('library.setFolder indexa la carpeta y library.search devuelve pistas sin rutas del sistema', async () => {
  const ctx = await startLibraryServer();
  try {
    const status = ctx.client.messages.findLast((m) => m.type === 'library').data;
    assert.deepEqual(status, { configured: true, folderName: 'musica', status: 'ready', count: 3 });

    const all = await ctx.search('');
    assert.equal(all.total, 3);
    assert.deepEqual(all.items.map((item) => item.artist), ['Artista Dos', 'Artista Uno', 'Rock']);
    assert.ok(all.items.every((item) => item.id === item.localId && item.favorite === false));
    assert.ok(!JSON.stringify(ctx.client.messages).includes(ctx.music));

    const found = await ctx.search('cancion');
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].title, 'Canción A');
  } finally {
    await ctx.cleanup();
  }
});

test('GET /media/:id sirve el archivo con Range y responde 404 a ids desconocidos o rutas fuera de la carpeta', async () => {
  const ctx = await startLibraryServer();
  try {
    const { id } = (await ctx.search('cancion')).items[0];
    const base = `http://127.0.0.1:${ctx.port}/media`;

    const full = await fetch(`${base}/${id}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'audio/mpeg');
    assert.equal(await full.text(), 'ABCDEFGHIJ');

    const partial = await fetch(`${base}/${id}`, { headers: { Range: 'bytes=2-4' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(await partial.text(), 'CDE');

    // Subcarpetas y nombres con % y # se sirven bien porque la ruta sale del índice, no de la URL.
    const odd = (await ctx.search('real')).items[0];
    const oddResponse = await fetch(`${base}/${odd.id}`);
    assert.equal(oddResponse.status, 200);
    assert.equal(await oddResponse.text(), '0123456789');

    for (const bad of ['0'.repeat(24), '..%2Fsecreto.mp3', '%2e%2e%2fsecreto.mp3', 'secreto.mp3', '..%5Csecreto.mp3']) {
      const response = await fetch(`${base}/${bad}`);
      assert.equal(response.status, 404, bad);
    }
  } finally {
    await ctx.cleanup();
  }
});

test('library.queue pone la pista local en la cola, favorite.set la añade a la lista base y ban.add la veta', async () => {
  const ctx = await startLibraryServer();
  try {
    const { client } = ctx;
    const { id } = (await ctx.search('cancion')).items[0];

    send(client, { type: 'library.queue', id });
    const playing = await client.waitFor((m) => m.type === 'state' && m.data.current?.source === 'local');
    assert.equal(playing.data.current.localId, id);
    assert.equal(playing.data.current.origin, 'request');
    assert.equal(playing.data.current.artist, 'Artista Uno');
    assert.equal(playing.data.current.favorite, false);

    send(client, { type: 'favorite.set', id, favorite: true });
    const list = await client.waitFor((m) => m.type === 'baselist' && m.data.items.length === 1);
    assert.equal(list.data.items[0].source, 'local');
    assert.equal(list.data.items[0].localId, id);
    await client.waitFor((m) => m.type === 'state' && m.data.current?.favorite === true);
    assert.equal((await ctx.search('cancion')).items[0].favorite, true);

    send(client, { type: 'ban.add', id });
    const banned = await client.waitFor((m) => m.type === 'baselist' && m.data.banned.length === 1);
    assert.equal(banned.data.banned[0].key, `local:${id}`);
    assert.deepEqual(banned.data.items, []);
    await client.waitFor((m) => m.type === 'state' && m.data.current === null);
    assert.equal((await ctx.search('cancion')).total, 0);

    send(client, { type: 'library.queue', id });
    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.trackBanned');

    send(client, { type: 'ban.remove', key: `local:${id}` });
    await client.waitFor((m) => m.type === 'baselist' && m.data.banned.length === 0);
    assert.equal((await ctx.search('cancion')).total, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('baselist.includeLibrary hace que START reproduzca pistas de la biblioteca', async () => {
  const ctx = await startLibraryServer();
  try {
    const { client } = ctx;
    send(client, { type: 'baselist.includeLibrary', enabled: true });
    const enabled = await client.waitFor((m) => m.type === 'state' && m.data.fallback.includeLibrary);
    assert.equal(enabled.data.current, null);

    send(client, { type: 'baselist.start', mode: 'shuffle' });
    const playing = await client.waitFor((m) => m.type === 'state' && m.data.current?.origin === 'base');
    assert.equal(playing.data.current.source, 'local');

    send(client, { type: 'baselist.includeLibrary', enabled: 'sí' });
    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.invalidMessage');
  } finally {
    await ctx.cleanup();
  }
});

test('library.setFolder rechaza rutas relativas, inexistentes o de tipo no válido', async () => {
  const { server, url } = await startServer();
  const client = await connect(url);
  try {
    send(client, { type: 'library.setFolder', path: 'musica' });
    send(client, { type: 'library.setFolder', path: 'C:\no\existe\nunca' });
    send(client, { type: 'library.setFolder', path: 42 });
    send(client, { type: 'library.search', query: 'x'.repeat(101) });

    await client.waitFor(() => client.messages.filter((m) => m.type === 'error').length === 4);
    // Los errores de ruta se resuelven de forma asíncrona, así que el orden de llegada no está fijado.
    assert.deepEqual(client.messages.filter((m) => m.type === 'error').map((m) => m.key).sort(), [
      'errors.folderInvalid',
      'errors.folderInvalid',
      'errors.invalidMessage',
      'errors.invalidMessage',
    ]);
    assert.equal(client.messages.findLast((m) => m.type === 'library').data.configured, false);
  } finally {
    client.socket.close();
    await server.close();
  }
});

test('library.addToBaseList añade la pista local sin marcarla como favorita y respeta la lista negra', async () => {
  const ctx = await startLibraryServer();
  try {
    const { client } = ctx;
    const { id } = (await ctx.search('cancion')).items[0];

    send(client, { type: 'library.addToBaseList', id });
    send(client, { type: 'library.addToBaseList', id });
    const list = await client.waitFor((m) => m.type === 'baselist' && m.data.items.length === 1);
    assert.equal(list.data.items[0].source, 'local');
    assert.equal(list.data.items[0].localId, id);
    assert.equal(list.data.items[0].favorite, false);

    send(client, { type: 'library.addToBaseList', id: 'no-existe' });
    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.trackNotFound');

    send(client, { type: 'ban.add', id });
    await client.waitFor((m) => m.type === 'baselist' && m.data.banned.length === 1);
    send(client, { type: 'library.addToBaseList', id });
    await client.waitFor((m) => m.type === 'error' && m.key === 'errors.trackBanned');

    const items = client.messages.filter((m) => m.type === 'baselist').at(-1).data.items;
    assert.deepEqual(items, [], 'tras vetar, la pista sale de la lista base y no vuelve a entrar');
  } finally {
    await ctx.cleanup();
  }
});

test('library.search devuelve la duración y busca en comentario y descripción de los archivos', async () => {
  const base = await mkdtemp(join(tmpdir(), 'bluejay-tags-server-'));
  const music = join(base, 'musica');
  await mkdir(music);
  await writeFile(join(music, 'pista.mp3'), 'datos');

  const { server, url } = await startServer({
    libraryConfigPath: join(base, 'library.json'),
    watchLibrary: false,
    readTags: async () => ({
      title: 'Canción etiquetada',
      artist: 'Alguien',
      album: null,
      notes: ['también conocida como Himno'],
      duration: 125.4,
    }),
  });
  const client = await connect(url);
  try {
    send(client, { type: 'library.setFolder', path: music });
    await client.waitFor((m) => m.type === 'library' && m.data.status === 'ready' && m.data.count === 1);

    send(client, { type: 'library.search', query: 'himno' });
    const found = await client.waitFor((m) => m.type === 'library.results' && m.query === 'himno');
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].title, 'Canción etiquetada');
    assert.equal(found.items[0].duration, 125.4);
  } finally {
    client.socket.close();
    await server.close();
    await rm(base, { recursive: true, force: true });
  }
});
