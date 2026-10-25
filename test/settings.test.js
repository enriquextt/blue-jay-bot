import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/database.js';
import { createKv } from '../server/db/kv.js';
import { Settings } from '../server/settings/settings.js';

function setup() {
  const kv = createKv(openDatabase());
  return { kv, settings: new Settings({ kv }) };
}

test('los ajustes arrancan con el chat activado y los límites por defecto', () => {
  const { settings } = setup();

  assert.deepEqual(settings.get(), {
    chatEnabled: true,
    localFallback: true,
    limits: { user: { enabled: true, max: 25 }, global: { enabled: true, max: 100 } },
  });
});

test('update aplica cambios parciales, avisa y se conserva al volver a abrir', () => {
  const { kv, settings } = setup();
  let changes = 0;
  settings.on('change', () => { changes += 1; });

  assert.equal(settings.update({ chatEnabled: false, limits: { user: { max: 5, enabled: false } } }), true);
  assert.equal(changes, 1);

  const reopened = new Settings({ kv }).get();
  assert.equal(reopened.chatEnabled, false);
  assert.deepEqual(reopened.limits.user, { enabled: false, max: 5 });
  assert.deepEqual(reopened.limits.global, { enabled: true, max: 100 });
});

test('update rechaza valores no válidos sin cambiar nada', () => {
  const { settings } = setup();
  const before = settings.get();

  for (const patch of [
    null,
    { chatEnabled: 'no' },
    { limits: { user: { max: 0 } } },
    { limits: { user: { max: 1.5 } } },
    { limits: { global: { max: 100000 } } },
    { limits: { global: { enabled: 1 } } },
    { chatEnabled: false, limits: { user: { max: -1 } } },
  ]) {
    assert.equal(settings.update(patch), false);
  }
  assert.deepEqual(settings.get(), before);
});

test('un ajuste guardado dañado se ignora campo a campo', () => {
  const { kv } = setup();
  kv.set('settings', { chatEnabled: 'x', limits: { user: { enabled: false, max: 'mucho' } } });

  const { chatEnabled, limits } = new Settings({ kv }).get();
  assert.equal(chatEnabled, true);
  assert.deepEqual(limits.user, { enabled: false, max: 25 });
});
