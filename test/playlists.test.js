import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/database.js';
import { MAX_ITEMS, MAX_PLAYLISTS, NAME_MAX_LENGTH, Playlists } from '../server/playlists/playlists.js';

const ID_A = 'aqz-KE-bpKQ';
const ID_B = 'dQw4w9WgXcQ';

const youtube = (videoId, title = videoId) => ({ source: 'youtube', videoId, title });
const local = { source: 'local', localId: 'c'.repeat(24), title: 'Local', artist: 'Artista' };

function setup() {
  return new Playlists({ db: openDatabase() });
}

test('crear una lista la añade con su nombre limpio y avisa del cambio', () => {
  const playlists = setup();
  let changes = 0;
  playlists.on('change', () => { changes += 1; });

  const id = playlists.create('  Para el directo  ');
  assert.deepEqual(playlists.list(), [{ id, name: 'Para el directo', count: 0 }]);
  assert.equal(changes, 1);
});

test('no se crean listas sin nombre, con nombre que no es texto o por encima del máximo', () => {
  const playlists = setup();
  assert.equal(playlists.create('   '), null);
  assert.equal(playlists.create(42), null);
  assert.equal(playlists.get(playlists.create('x'.repeat(200))).name.length, NAME_MAX_LENGTH);

  for (let i = 1; i < MAX_PLAYLISTS; i += 1) playlists.create(`Lista ${i}`);
  assert.equal(playlists.create('Una más'), null);
});

test('addTracks guarda pistas de YouTube y locales sin repetirlas', () => {
  const playlists = setup();
  const id = playlists.create('Mix');

  assert.equal(playlists.addTracks(id, [youtube(ID_A, 'A'), local, youtube(ID_A, 'A otra vez')]), 2);
  assert.equal(playlists.addTracks(id, [youtube(ID_A)]), 0);

  const { items } = playlists.get(id);
  assert.deepEqual(items.map(({ id: _id, ...entry }) => entry), [youtube(ID_A, 'A'), local]);
  assert.deepEqual(playlists.list(), [{ id, name: 'Mix', count: 2 }]);
});

test('la misma pista puede estar en listas distintas', () => {
  const playlists = setup();
  const first = playlists.create('Una');
  const second = playlists.create('Dos');

  assert.equal(playlists.addTracks(first, [youtube(ID_A)]), 1);
  assert.equal(playlists.addTracks(second, [youtube(ID_A)]), 1);
});

test('addTracks devuelve null si la lista no existe y respeta el máximo', () => {
  const playlists = setup();
  assert.equal(playlists.addTracks(99, [youtube(ID_A)]), null);

  const id = playlists.create('Grande');
  const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => youtube(`${String(i).padStart(11, 'a')}`));
  assert.equal(playlists.addTracks(id, many), MAX_ITEMS);
});

test('removeItem quita una pista e itemTrack la devuelve mientras exista', () => {
  const playlists = setup();
  const id = playlists.create('Mix');
  playlists.addTracks(id, [youtube(ID_A, 'A'), youtube(ID_B, 'B')]);

  const [first, second] = playlists.get(id).items;
  assert.deepEqual(playlists.itemTrack(first.id), youtube(ID_A, 'A'));
  assert.equal(playlists.removeItem(first.id), true);
  assert.equal(playlists.removeItem(first.id), false);
  assert.equal(playlists.itemTrack(first.id), null);
  assert.deepEqual(playlists.get(id).items.map((item) => item.id), [second.id]);
});

test('rename cambia el nombre y remove borra la lista con sus pistas', () => {
  const playlists = setup();
  const id = playlists.create('Vieja');
  playlists.addTracks(id, [youtube(ID_A)]);
  const [{ id: itemId }] = playlists.get(id).items;

  assert.equal(playlists.rename(id, 'Nueva'), true);
  assert.equal(playlists.rename(id, ' '), false);
  assert.equal(playlists.rename(99, 'Nada'), false);
  assert.equal(playlists.get(id).name, 'Nueva');

  assert.equal(playlists.remove(id), true);
  assert.equal(playlists.remove(id), false);
  assert.equal(playlists.get(id), null);
  assert.equal(playlists.itemTrack(itemId), null);
});
