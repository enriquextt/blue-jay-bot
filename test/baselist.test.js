import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseList, MAX_ITEMS } from '../server/baselist/base-list.js';
import { Blacklist } from '../server/baselist/blacklist.js';
import { PlaybackQueue } from '../server/queue/playback-queue.js';

const IDS = ['aqz-KE-bpKQ', 'dQw4w9WgXcQ', 'jNQXAC9IVRw', 'kJQP7kiw5Fk'];

function entry(index) {
  return { videoId: IDS[index], title: `Título ${index}` };
}

function playOrder(baseList, count) {
  return Array.from({ length: count }, () => baseList.next().videoId);
}

test('la lista base parada o vacía no devuelve pistas', () => {
  const baseList = new BaseList();
  assert.equal(baseList.next(), null);

  baseList.start('sequential');
  assert.equal(baseList.next(), null);

  baseList.addMany([entry(0)]);
  baseList.stop();
  assert.equal(baseList.next(), null);
});

test('addMany ignora duplicados y respeta el límite', () => {
  const baseList = new BaseList();
  assert.equal(baseList.addMany([entry(0), entry(0), entry(1)]), 2);
  assert.equal(baseList.addMany([entry(1)]), 0);

  const full = new BaseList();
  const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ videoId: String(i).padStart(11, '0'), title: 'x' }));
  assert.equal(full.addMany(many), MAX_ITEMS);
  assert.equal(full.isFull(), true);
  assert.equal(full.setFavorite({ videoId: 'zzzzzzzzzzz', title: 'y' }, true), false);
});

test('los favoritos aparecen arriba y suenan primero en modo secuencial', () => {
  const baseList = new BaseList();
  baseList.addMany([entry(0), entry(1), entry(2)]);
  baseList.setFavorite(entry(2), true);

  assert.deepEqual(baseList.list().map((item) => item.videoId), [IDS[2], IDS[0], IDS[1]]);

  baseList.start('sequential');
  assert.deepEqual(playOrder(baseList, 4), [IDS[2], IDS[0], IDS[1], IDS[2]]);
});

test('marcar favorita una canción que no está en la lista base la añade', () => {
  const baseList = new BaseList();
  assert.equal(baseList.setFavorite(entry(0), false), true);
  assert.equal(baseList.list().length, 0);

  baseList.setFavorite(entry(0), true);
  assert.equal(baseList.isFavorite(IDS[0]), true);

  baseList.setFavorite(entry(0), false);
  assert.equal(baseList.isFavorite(IDS[0]), false);
  assert.equal(baseList.list().length, 1);
});

test('shuffle recorre todas las pistas antes de repetir', () => {
  const baseList = new BaseList();
  baseList.addMany(IDS.map((videoId, i) => ({ videoId, title: `T${i}` })));
  baseList.start('shuffle');

  for (let cycle = 0; cycle < 5; cycle += 1) {
    assert.deepEqual(playOrder(baseList, IDS.length).sort(), [...IDS].sort());
  }
});

test('las pistas quitadas durante la reproducción se saltan', () => {
  const baseList = new BaseList();
  baseList.addMany([entry(0), entry(1), entry(2)]);
  baseList.start('sequential');
  assert.equal(baseList.next().videoId, IDS[0]);

  baseList.removeByVideoId(IDS[1]);
  assert.equal(baseList.next().videoId, IDS[2]);
  assert.equal(baseList.next().videoId, IDS[0]);
});

test('la cola reproduce la lista base cuando se vacía y prioriza las peticiones', () => {
  const baseList = new BaseList();
  baseList.addMany([entry(0), entry(1)]);
  baseList.start('sequential');
  const queue = new PlaybackQueue({ fallback: () => baseList.next() });

  queue.advance();
  assert.equal(queue.snapshot().current.videoId, IDS[0]);
  assert.equal(queue.snapshot().current.origin, 'base');

  queue.add({ videoId: IDS[3], title: 'Petición', requestedBy: 'twitch:ana' });
  assert.equal(queue.snapshot().current.videoId, IDS[0], 'la petición espera a que acabe la canción actual');

  queue.advance();
  assert.equal(queue.snapshot().current.origin, 'request');
  queue.advance();
  assert.equal(queue.snapshot().current.videoId, IDS[1]);
});

test('removeByVideoId quita de la cola y avanza si el vídeo está sonando', () => {
  const queue = new PlaybackQueue();
  queue.add({ videoId: IDS[0], title: 'A' });
  queue.add({ videoId: IDS[1], title: 'B' });
  queue.add({ videoId: IDS[0], title: 'A otra vez' });

  assert.equal(queue.removeByVideoId(IDS[0]), 2);
  const { current, queue: pending } = queue.snapshot();
  assert.equal(current.videoId, IDS[1]);
  assert.deepEqual(pending, []);
});

test('la lista base y la lista negra se guardan y se recuperan del disco', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluejay-'));
  try {
    const baseListPath = join(dir, 'data', 'baselist.json');
    const blacklistPath = join(dir, 'blacklist.json');

    const baseList = new BaseList({ path: baseListPath });
    baseList.addMany([entry(0), entry(1)]);
    baseList.setFavorite(entry(1), true);
    await baseList.flush();

    const blacklist = new Blacklist({ path: blacklistPath });
    blacklist.add(entry(2));
    await blacklist.flush();

    const reloaded = new BaseList({ path: baseListPath });
    await reloaded.load();
    assert.deepEqual(reloaded.list().map((item) => [item.videoId, item.favorite]), [[IDS[1], true], [IDS[0], false]]);

    const reloadedBlacklist = new Blacklist({ path: blacklistPath });
    await reloadedBlacklist.load();
    assert.equal(reloadedBlacklist.has(IDS[2]), true);

    assert.equal(JSON.parse(await readFile(blacklistPath, 'utf8'))[0].videoId, IDS[2]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('un archivo dañado o con entradas no válidas se ignora', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluejay-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    const path = join(dir, 'baselist.json');
    await writeFile(path, JSON.stringify([{ videoId: 'corto', title: 'x' }, { videoId: IDS[0], title: 'ok' }, null]));

    const baseList = new BaseList({ path });
    await baseList.load();
    assert.deepEqual(baseList.list().map((item) => item.videoId), [IDS[0]]);

    await writeFile(path, '{ no es json');
    const broken = new BaseList({ path, log: () => {} });
    await broken.load();
    assert.deepEqual(broken.list(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
