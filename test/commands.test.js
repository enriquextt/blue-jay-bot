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
  const blacklist = { has: (videoId) => videoId === ID_A };
  const { queue, changes, say } = await setup({ blacklist });

  assert.match(await say('ana', `!sr ${ID_A}`), /vetada/);
  assert.equal(queue.snapshot().current, null);
  assert.equal(changes.count, 0);

  assert.match(await say('ana', `!sr ${ID_B}`), /suena ahora/);
});
