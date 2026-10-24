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

test('advance con la cola vacía deja current en null', () => {
  const queue = new PlaybackQueue();
  queue.add({ videoId: 'a', title: 'A' });
  queue.advance();

  assert.equal(queue.snapshot().current, null);
});
