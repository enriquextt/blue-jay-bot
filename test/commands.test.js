import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue } from '../server/queue/playback-queue.js';
import { createCommands } from '../server/commands/index.js';
import { createTranslator } from '../server/i18n/index.js';

const ID_A = 'aqz-KE-bpKQ';
const ID_B = 'dQw4w9WgXcQ';
const ID_C = 'jNQXAC9IVRw';

async function setup(options = {}) {
  const queue = new PlaybackQueue();
  const changes = { count: 0 };
  const commands = createCommands({
    queue,
    fetchTitle: async (videoId) => `Título ${videoId}`,
    t: await createTranslator('es'),
    onChange: () => { changes.count += 1; },
    ...options,
  });
  const say = (user, text, isMod = false) => commands.handle({ platform: 'twitch', user, text, isMod });
  return { queue, changes, say };
}

test('un mensaje sin prefijo o con un comando desconocido no recibe respuesta', async () => {
  const { say } = await setup();
  assert.equal(await say('ana', 'hola'), null);
  assert.equal(await say('ana', '!nadaconocido'), null);
  assert.equal(await say('ana', '!constructor'), null);
});

test('!sr añade la canción, avisa del cambio y responde con la posición', async () => {
  const { queue, changes, say } = await setup();

  assert.match(await say('ana', `!sr ${ID_A}`), /suena ahora/);
  assert.match(await say('ana', `!SR https://youtu.be/${ID_B}`), /posición 1/);
  assert.equal(changes.count, 2);
  assert.equal(queue.snapshot().queue[0].requestedBy, 'twitch:ana');
});

test('!sr sin argumento o con un enlace inválido no toca la cola', async () => {
  const { queue, changes, say } = await setup();

  assert.match(await say('ana', '!sr'), /usa !sr/);
  assert.match(await say('ana', '!sr https://example.com/x'), /no es válido/);
  assert.equal(queue.snapshot().current, null);
  assert.equal(changes.count, 0);
});

test('!sr busca por título cuando hay búsqueda y distingue enlaces inválidos', async () => {
  const searches = [];
  const searchVideo = async (query) => {
    searches.push(query);
    return query === 'sin resultados' ? null : ID_A;
  };
  const { queue, say } = await setup({ searchVideo });

  assert.match(await say('ana', '!sr mi canción favorita'), /suena ahora/);
  assert.equal(queue.snapshot().current.videoId, ID_A);
  assert.deepEqual(searches, ['mi canción favorita']);

  assert.match(await say('ana', '!sr sin resultados'), /no encontré/);
  assert.match(await say('ana', '!sr https://example.com/x'), /no es válido/);
  assert.equal(searches.length, 2);
});

test('!sr por título responde con un aviso si la búsqueda no está activada o falla', async () => {
  const disabled = await setup();
  assert.match(await disabled.say('ana', '!sr una canción'), /no está activada/);

  const failing = await setup({ searchVideo: async () => { throw new Error('cuota'); } });
  assert.match(await failing.say('ana', '!sr una canción'), /no se pudo buscar/);
  assert.equal(failing.queue.snapshot().current, null);
});

test('!queue lista la canción actual y las siguientes', async () => {
  const { say } = await setup();
  assert.match(await say('ana', '!queue'), /nada sonando/);

  await say('ana', `!sr ${ID_A}`);
  assert.match(await say('ana', '!queue'), /No hay más/);

  await say('bea', `!sr ${ID_B}`);
  assert.match(await say('ana', '!queue'), /Siguientes: 1\. Título dQw4w9WgXcQ/);
});

test('!when indica cuántas canciones van antes de la del usuario', async () => {
  const { say } = await setup();
  await say('ana', `!sr ${ID_A}`);
  await say('bea', `!sr ${ID_B}`);
  await say('cris', `!sr ${ID_C}`);

  assert.match(await say('ana', '!when'), /suena ahora/);
  assert.match(await say('bea', '!when'), /después de 1 canción\./);
  assert.match(await say('cris', '!when'), /después de 2 canciones/);
  assert.match(await say('dani', '!when'), /no tienes ninguna/);
});

test('!skip solo lo pueden usar los moderadores', async () => {
  const { queue, say } = await setup();
  await say('ana', `!sr ${ID_A}`);
  await say('ana', `!sr ${ID_B}`);

  assert.match(await say('ana', '!skip'), /solo los moderadores/);
  assert.equal(queue.snapshot().current.videoId, ID_A);

  assert.match(await say('mod', '!skip', true), /Saltada/);
  assert.equal(queue.snapshot().current.videoId, ID_B);
  assert.match(await say('mod', '!skip', true), /Saltada/);
  assert.match(await say('mod', '!skip', true), /ninguna canción/);
});

test('!voteskip salta al llegar al umbral y no cuenta votos repetidos', async () => {
  const { queue, say } = await setup({ voteSkipThreshold: 2 });
  await say('ana', `!sr ${ID_A}`);
  await say('ana', `!sr ${ID_B}`);

  assert.match(await say('bea', '!voteskip'), /1\/2/);
  assert.match(await say('BEA', '!voteskip'), /ya has votado/);
  assert.equal(queue.snapshot().current.videoId, ID_A);

  assert.match(await say('cris', '!voteskip'), /Saltada/);
  assert.equal(queue.snapshot().current.videoId, ID_B);

  // Los votos son por canción: el voto anterior no cuenta para la nueva.
  assert.match(await say('bea', '!voteskip'), /1\/2/);
});

test('!wrongsong retira la última petición del usuario', async () => {
  const { queue, say } = await setup();
  await say('ana', `!sr ${ID_A}`);
  await say('bea', `!sr ${ID_B}`);
  await say('bea', `!sr ${ID_C}`);

  assert.match(await say('bea', '!wrongsong'), new RegExp(`Título ${ID_C}`));
  assert.deepEqual(queue.snapshot().queue.map((track) => track.videoId), [ID_B]);

  assert.match(await say('bea', '!wrongsong'), new RegExp(`Título ${ID_B}`));
  assert.match(await say('bea', '!wrongsong'), /no tienes ninguna/);
  assert.equal(queue.snapshot().current.videoId, ID_A);
});

test('!volume consulta para todos y ajusta solo para moderadores', async () => {
  const { queue, say } = await setup();

  assert.match(await say('ana', '!volume'), /50%/);
  assert.match(await say('ana', '!volume 20'), /solo los moderadores/);
  assert.match(await say('mod', '!volume 20', true), /20%/);
  assert.equal(queue.snapshot().volume, 20);

  for (const invalid of ['101', 'alto', '-5', '1.5']) {
    assert.match(await say('mod', `!volume ${invalid}`, true), /entre 0 y 100/);
  }
  assert.equal(queue.snapshot().volume, 20);
});

test('las respuestas salen en inglés si se configura ese idioma', async () => {
  const { say } = await setup({ t: await createTranslator('en') });
  assert.match(await say('ana', '!queue'), /Nothing is playing/);
});

test('!sr rechaza las canciones de la lista negra', async () => {
  const blacklist = { has: ({ videoId }) => videoId === ID_A };
  const { queue, changes, say } = await setup({ blacklist });

  assert.match(await say('ana', `!sr ${ID_A}`), /vetada/);
  assert.equal(queue.snapshot().current, null);
  assert.equal(changes.count, 0);

  assert.match(await say('ana', `!sr ${ID_B}`), /suena ahora/);
});

// --- Biblioteca local en el chat ---

const LOCAL_TRACKS = [
  { source: 'local', localId: 'a'.repeat(24), title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213 },
  { source: 'local', localId: 'b'.repeat(24), title: 'Tema sin artista', artist: null, duration: null },
];

// Biblioteca falsa: coincide si todas las palabras aparecen en título, artista o en un texto extra.
function fakeLibrary(tracks = LOCAL_TRACKS, extra = { [LOCAL_TRACKS[0].localId]: 'rickroll nunca te voy a dejar' }) {
  const searches = [];
  return {
    searches,
    status: () => ({ count: tracks.length }),
    search(query, { limit = 50, exclude = () => false } = {}) {
      searches.push(query);
      const terms = query.toLowerCase().split(/\s+/);
      const items = tracks
        .filter((track) => !exclude(track))
        .filter((track) => {
          const text = `${track.title} ${track.artist ?? ''} ${extra[track.localId] ?? ''}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        });
      return { items: items.slice(0, limit), total: items.length };
    },
  };
}

test('!sr busca primero en la biblioteca local y no consulta YouTube si hay coincidencia', async () => {
  const youtubeSearches = [];
  const searchVideo = async (query) => {
    youtubeSearches.push(query);
    return ID_A;
  };
  const { queue, say } = await setup({ library: fakeLibrary(), searchVideo });

  assert.match(await say('ana', '!sr rickroll'), /«Rick Astley - Never Gonna Give You Up» suena ahora/);
  assert.equal(queue.snapshot().current.source, 'local');
  assert.equal(queue.snapshot().current.requestedBy, 'twitch:ana');
  assert.deepEqual(youtubeSearches, []);

  assert.match(await say('ana', '!sr tema sin artista'), /«Tema sin artista» añadida en la posición 1/);
});

test('!sr consulta YouTube si la biblioteca local no tiene nada parecido, y los enlaces no pasan por la biblioteca', async () => {
  const youtubeSearches = [];
  const searchVideo = async (query) => {
    youtubeSearches.push(query);
    return ID_A;
  };
  const library = fakeLibrary();
  const { queue, say } = await setup({ library, searchVideo });

  assert.match(await say('ana', '!sr una canción que no tengo'), /suena ahora/);
  assert.equal(queue.snapshot().current.videoId, ID_A);
  assert.deepEqual(youtubeSearches, ['una canción que no tengo']);

  await say('ana', `!sr https://youtu.be/${ID_B}`);
  await say('ana', `!sr ${ID_C}`);
  assert.deepEqual(library.searches, ['una canción que no tengo'], 'enlaces e ids no buscan en la biblioteca');
});

test('!sr con biblioteca local y sin búsqueda de YouTube sigue avisando cuando no hay coincidencia', async () => {
  const { say } = await setup({ library: fakeLibrary() });

  assert.match(await say('ana', '!sr rickroll'), /suena ahora/);
  assert.match(await say('ana', '!sr nada parecido'), /no está activada/);
});

test('!sr y !local ignoran las pistas locales vetadas', async () => {
  const blacklist = { has: (track) => track.localId === LOCAL_TRACKS[0].localId };
  const { queue, say } = await setup({ library: fakeLibrary(), blacklist });

  assert.match(await say('ana', '!local rickroll'), /no encontré ninguna pista local/);
  assert.match(await say('ana', '!sr rickroll'), /no está activada/);
  assert.equal(queue.snapshot().current, null);
});

test('!local añade solo pistas de la biblioteca y explica cuándo no se puede usar', async () => {
  const youtubeSearches = [];
  const searchVideo = async (query) => {
    youtubeSearches.push(query);
    return ID_A;
  };
  const { queue, changes, say } = await setup({ library: fakeLibrary(), searchVideo });

  assert.match(await say('ana', '!local'), /usa !local/);
  assert.match(await say('ana', '!local nada parecido'), /no encontré ninguna pista local para «nada parecido»/);
  assert.equal(queue.snapshot().current, null);
  assert.equal(changes.count, 0);

  assert.match(await say('ana', '!LOCAL Nunca te voy'), /Rick Astley - Never Gonna Give You Up/);
  assert.equal(queue.snapshot().current.localId, LOCAL_TRACKS[0].localId);
  assert.deepEqual(youtubeSearches, [], '!local nunca pregunta a YouTube');

  const withoutLibrary = await setup();
  assert.match(await withoutLibrary.say('ana', '!local algo'), /no está disponible/);
  const emptyLibrary = await setup({ library: fakeLibrary([]) });
  assert.match(await emptyLibrary.say('ana', '!local algo'), /no está disponible/);
});

test('!queue, !when y !wrongsong nombran las pistas locales con su artista', async () => {
  const { say } = await setup({ library: fakeLibrary() });

  await say('bob', `!sr ${ID_A}`);
  await say('ana', '!local rickroll');

  assert.match(await say('ana', '!queue'), /Siguientes: 1\. Rick Astley - Never Gonna Give/);
  assert.match(await say('ana', '!when'), /«Rick Astley - Never Gonna Give You Up» suena después de 1 canción/);
  assert.match(await say('ana', '!wrongsong'), /«Rick Astley - Never Gonna Give You Up»/);
});

test('!sr y !local piden la búsqueda estricta a la biblioteca local', async () => {
  const library = fakeLibrary();
  const calls = [];
  const search = library.search;
  library.search = (query, options) => {
    calls.push(options);
    return search(query, options);
  };
  const { say } = await setup({ library, searchVideo: async () => ID_A });

  await say('ana', '!sr rickroll');
  await say('ana', '!local rickroll');
  await say('ana', '!sr algo que no tengo');

  assert.equal(calls.length, 3);
  assert.ok(calls.every((options) => options.strict === true && options.limit === 1));
});

test('!local explica que un título corto necesita el artista o el álbum', async () => {
  const { say } = await setup({ library: fakeLibrary() });

  assert.match(await say('ana', '!local nada'), /Si el título es corto, añade también el artista o el álbum/);
});
