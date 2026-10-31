import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue } from '../server/queue/playback-queue.js';

function titles(queue) {
  return queue.snapshot().queue.map((track) => track.title);
}

test('la primera canción añadida empieza a sonar', () => {
  const queue = new PlaybackQueue();
  queue.add({ videoId: 'a', title: 'A' });
  queue.add({ videoId: 'b', title: 'B' });

  const { current } = queue.snapshot();
  assert.equal(current.title, 'A');
  assert.deepEqual(titles(queue), ['B']);
});

test('finish solo avanza si el id coincide con la canción que suena', () => {
  const queue = new PlaybackQueue();
  queue.add({ videoId: 'a', title: 'A' });
  queue.add({ videoId: 'b', title: 'B' });
  const { current } = queue.snapshot();

  assert.equal(queue.finish('otro-id'), false);
  assert.equal(queue.finish(current.id), true);
  assert.equal(queue.snapshot().current.title, 'B');
  assert.equal(queue.finish(current.id), false);
});

test('move reordena las pendientes y limita la posición', () => {
  const queue = new PlaybackQueue();
  ['A', 'B', 'C', 'D'].forEach((title) => queue.add({ videoId: title, title }));
  const { id } = queue.snapshot().queue[1];

  assert.equal(queue.move(id, 0), true);
  assert.deepEqual(titles(queue), ['C', 'B', 'D']);

  assert.equal(queue.move(id, 99), true);
  assert.deepEqual(titles(queue), ['B', 'D', 'C']);
});

test('remove quita una pendiente y avanza si se quita la que suena', () => {
  const queue = new PlaybackQueue();
  ['A', 'B', 'C'].forEach((title) => queue.add({ videoId: title, title }));
  const { current } = queue.snapshot();
  const { id: pendingId } = queue.snapshot().queue[1];

  assert.equal(queue.remove(pendingId), true);
  assert.deepEqual(titles(queue), ['B']);

  assert.equal(queue.remove(current.id), true);
  assert.equal(queue.snapshot().current.title, 'B');
  assert.deepEqual(titles(queue), []);
  assert.equal(queue.remove(current.id), false);
});

test('setPaused solo actúa con una pista sonando, avisa de si cambió algo y se rearma al avanzar', () => {
  const queue = new PlaybackQueue();
  assert.equal(queue.setPaused(true), false);
  assert.equal(queue.snapshot().paused, false);

  ['A', 'B'].forEach((title) => queue.add({ videoId: title, title }));
  assert.equal(queue.setPaused(true), true);
  assert.equal(queue.setPaused(true), false);
  assert.equal(queue.snapshot().paused, true);

  queue.advance();
  assert.equal(queue.snapshot().paused, false);

  queue.setPaused(true);
  queue.replaceCurrent(queue.snapshot().current.id, { videoId: 'C', title: 'C' });
  assert.equal(queue.snapshot().paused, false);
});

test('advance con la cola vacía deja current en null', () => {
  const queue = new PlaybackQueue();
  queue.add({ videoId: 'a', title: 'A' });
  queue.advance();

  assert.equal(queue.snapshot().current, null);
});

test('onPlay se llama cada vez que una pista empieza a sonar, pero no al restaurar', () => {
  const played = [];
  const queue = new PlaybackQueue({ onPlay: (track) => played.push(track.title) });
  queue.add({ videoId: 'a', title: 'A' });
  queue.add({ videoId: 'b', title: 'B' });
  queue.advance();
  queue.advance();
  assert.deepEqual(played, ['A', 'B']);

  queue.restore({ current: { source: 'youtube', videoId: 'c', title: 'C', origin: 'request', requestedBy: null } });
  assert.deepEqual(played, ['A', 'B']);
});

test('restore recupera la cola con su origen, quien la pidió y el volumen', () => {
  const queue = new PlaybackQueue();
  queue.restore({
    current: { source: 'youtube', videoId: 'a', title: 'A', origin: 'base', requestedBy: null },
    queue: [{ source: 'youtube', videoId: 'b', title: 'B', origin: 'request', requestedBy: 'twitch:ana' }],
    volume: 80,
  });

  const { current, queue: pending, volume } = queue.snapshot();
  assert.equal(current.origin, 'base');
  assert.equal(pending[0].requestedBy, 'twitch:ana');
  assert.equal(volume, 80);
  assert.notEqual(current.id, pending[0].id);
});

test('clear vacía las pendientes sin tocar la que suena y activeRequests cuenta solo peticiones', () => {
  const queue = new PlaybackQueue();
  queue.add({ videoId: 'a', title: 'A', requestedBy: 'twitch:ana' });
  queue.add({ videoId: 'b', title: 'B', requestedBy: 'twitch:ana' });
  queue.add({ videoId: 'c', title: 'C', requestedBy: 'twitch:bea' });

  assert.equal(queue.activeRequests(), 3);
  assert.equal(queue.activeRequests('twitch:ana'), 2);
  assert.equal(queue.clear(), 2);
  assert.equal(queue.snapshot().current.title, 'A');
  assert.equal(queue.activeRequests('twitch:ana'), 1);
});

test('replaceCurrent cambia la pista que suena conservando origen y petición, y avisa con onPlay', () => {
  const played = [];
  const queue = new PlaybackQueue({ onPlay: (track) => played.push(track.title) });
  queue.add({ videoId: 'a', title: 'A', requestedBy: 'twitch:ana' });
  queue.add({ videoId: 'b', title: 'B' });
  const { current } = queue.snapshot();

  const replaced = queue.replaceCurrent(current.id, { source: 'local', localId: 'c'.repeat(24), title: 'C', artist: 'Artista' });
  assert.equal(replaced.title, 'C');
  assert.equal(replaced.requestedBy, 'twitch:ana');
  assert.equal(replaced.origin, 'request');
  assert.notEqual(replaced.id, current.id);
  assert.deepEqual(titles(queue), ['B']);
  assert.deepEqual(played, ['A', 'C']);

  assert.equal(queue.replaceCurrent(current.id, { videoId: 'd', title: 'D' }), null);
  assert.equal(queue.snapshot().current.title, 'C');
});
