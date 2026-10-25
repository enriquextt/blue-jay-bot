import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/database.js';
import { createKv } from '../server/db/kv.js';
import { PlayerState } from '../server/state/player-state.js';

const youtube = (videoId, extra = {}) => ({ source: 'youtube', videoId, title: videoId, origin: 'request', requestedBy: null, ...extra });
const idle = { current: null, queue: [], volume: 50, fallback: { active: false, mode: 'sequential', includeLibrary: false } };

function setup() {
  const kv = createKv(openDatabase());
  return { kv, state: new PlayerState({ kv }) };
}

test('sin nada guardado, load devuelve null', () => {
  assert.equal(setup().state.load(), null);
});

test('save y load conservan la cola, la canción actual, el volumen y la lista base', () => {
  const { state } = setup();
  const local = { source: 'local', localId: 'a'.repeat(24), title: 'Local', artist: 'Artista', origin: 'base', requestedBy: null };
  state.save({
    current: youtube('aqz-KE-bpKQ', { requestedBy: 'twitch:ana' }),
    queue: [local, youtube('dQw4w9WgXcQ')],
    volume: 35,
    fallback: { active: true, mode: 'shuffle', includeLibrary: true },
  });

  const loaded = state.load();
  assert.equal(loaded.current.requestedBy, 'twitch:ana');
  assert.deepEqual(loaded.queue, [local, youtube('dQw4w9WgXcQ')]);
  assert.equal(loaded.volume, 35);
  assert.deepEqual(loaded.fallback, { active: true, mode: 'shuffle', includeLibrary: true });
});

test('load descarta entradas dañadas y corrige valores fuera de rango', () => {
  const { kv, state } = setup();
  kv.set('player', {
    current: { source: 'youtube', videoId: 'corto', title: 'x' },
    queue: [youtube('aqz-KE-bpKQ'), { source: 'local', localId: 'zz', title: 'x' }, 'basura', null],
    volume: 400,
    fallback: { active: 'sí', mode: 'otro' },
  });

  assert.deepEqual(state.load(), {
    current: null,
    queue: [youtube('aqz-KE-bpKQ')],
    volume: null,
    fallback: { active: false, mode: 'sequential', includeLibrary: false },
  });
});

test('un estado guardado que no es un objeto se ignora', () => {
  const { kv, state } = setup();
  kv.set('player', 'texto');
  assert.equal(state.load(), null);

  state.save(idle);
  assert.equal(state.load().volume, 50);
});
