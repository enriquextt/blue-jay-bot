import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/database.js';
import { History } from '../server/history/history.js';

const ID_A = 'aqz-KE-bpKQ';
const ID_B = 'dQw4w9WgXcQ';
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const clock = { now: 1_000_000 };
  const history = new History({ db: openDatabase(), now: () => clock.now });
  return { history, clock };
}

const request = (overrides = {}) => ({
  platform: 'twitch',
  user: 'ana',
  command: 'sr',
  input: ID_A,
  kind: 'link',
  outcome: 'accepted',
  track: { source: 'youtube', videoId: ID_A, title: 'Canción A' },
  ...overrides,
});

test('una petición aceptada guarda la pista; una rechazada guarda solo el motivo', () => {
  const { history } = setup();
  history.logRequest(request());
  history.logRequest(request({ input: 'https://example.com/x', outcome: 'invalid_url', track: null }));

  const { total, items } = history.query('requests');
  assert.equal(total, 2);
  assert.equal(items[0].outcome, 'invalid_url');
  assert.equal(items[0].input, 'https://example.com/x');
  assert.equal(items[0].track, null);
  assert.deepEqual(items[1].track, { source: 'youtube', videoId: ID_A, title: 'Canción A' });
  assert.equal(items[1].user, 'ana');
});

test('el historial devuelve primero lo más reciente y pagina', () => {
  const { history, clock } = setup();
  for (const user of ['a', 'b', 'c']) {
    clock.now += 1000;
    history.logRequest(request({ user }));
  }

  assert.deepEqual(history.query('requests', { limit: 2 }).items.map((item) => item.user), ['c', 'b']);
  const page = history.query('requests', { limit: 2, offset: 2 });
  assert.deepEqual(page.items.map((item) => item.user), ['a']);
  assert.equal(page.total, 3);
});

test('los filtros combinan usuario, resultado y fechas', () => {
  const { history, clock } = setup();
  clock.now = 10 * DAY;
  history.logRequest(request({ user: 'ana' }));
  clock.now = 11 * DAY;
  history.logRequest(request({ user: 'Anabel', outcome: 'invalid_url', track: null }));
  clock.now = 12 * DAY;
  history.logRequest(request({ user: 'luis' }));

  const users = (filters) => history.query('requests', filters).items.map((item) => item.user).sort();
  assert.deepEqual(users({ user: 'ANA' }), ['Anabel', 'ana']);
  assert.deepEqual(users({ outcome: 'invalid_url' }), ['Anabel']);
  assert.deepEqual(users({ from: 11 * DAY }), ['Anabel', 'luis']);
  assert.deepEqual(users({ to: 11 * DAY }), ['Anabel', 'ana']);
  assert.deepEqual(users({ user: 'ana', from: 11 * DAY }), ['Anabel']);
  assert.equal(history.query('requests', { user: '%' }).total, 0);
});

test('el historial de reproducción guarda origen y quién pidió la canción', () => {
  const { history } = setup();
  history.logPlay({ source: 'youtube', videoId: ID_A, title: 'A', origin: 'request', requestedBy: 'twitch:ana' });
  history.logPlay({ source: 'local', localId: 'a'.repeat(24), title: 'B', artist: 'Artista', origin: 'base', requestedBy: null });

  const { items } = history.query('plays');
  assert.equal(items[0].origin, 'base');
  assert.equal(items[0].requestedBy, null);
  assert.equal(items[0].track.artist, 'Artista');
  assert.equal(items[1].requestedBy, 'twitch:ana');
  assert.deepEqual(history.query('plays', { user: 'ana' }).items.map((item) => item.track.title), ['A']);
});

test('delete borra una fila y clear vacía solo un historial', () => {
  const { history } = setup();
  let changes = 0;
  history.on('change', () => { changes += 1; });

  history.logRequest(request());
  history.logRequest(request());
  history.logPlay({ source: 'youtube', videoId: ID_B, title: 'B', origin: 'request' });
  changes = 0;

  const [{ id }] = history.query('requests').items;
  assert.equal(history.delete('requests', id), true);
  assert.equal(history.delete('requests', id), false);
  assert.equal(history.query('requests').total, 1);

  history.clear('requests');
  assert.equal(history.query('requests').total, 0);
  assert.equal(history.query('plays').total, 1);
  assert.equal(changes, 2);
});

test('trackOf devuelve la pista de una fila o null si no la tiene', () => {
  const { history } = setup();
  history.logRequest(request());
  history.logRequest(request({ outcome: 'not_found', track: null }));

  const [rejected, accepted] = history.query('requests').items;
  assert.equal(history.trackOf('requests', rejected.id), null);
  assert.equal(history.trackOf('requests', accepted.id).videoId, ID_A);
  assert.equal(history.trackOf('requests', 9999), null);
});

test('la entrada del usuario se recorta y el historial no crece sin límite', () => {
  const { history } = setup();
  history.logRequest(request({ input: 'x'.repeat(500), track: null }));
  assert.equal(history.query('requests').items[0].input.length, 200);

  for (let i = 0; i < 10005; i += 1) history.logPlay({ source: 'youtube', videoId: ID_B, title: `T${i}`, origin: 'base' });
  const { total, items } = history.query('plays', { limit: 1 });
  assert.equal(total, 10000);
  assert.equal(items[0].track.title, 'T10004');
});
