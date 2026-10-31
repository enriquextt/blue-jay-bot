import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/database.js';
import { createKv } from '../server/db/kv.js';
import { createTranslator, loadLocales } from '../server/i18n/index.js';
import { MAX_LENGTH, Messages } from '../server/i18n/messages.js';

async function setup(kv = createKv(openDatabase())) {
  const locales = await loadLocales();
  const messages = new Messages({ kv, locales });
  const t = await createTranslator('es', { locales, messages });
  return { kv, locales, messages, t };
}

const find = (messages, key) => messages.list().find((item) => item.key === key);

test('el catálogo agrupa los plurales en un mensaje y detecta sus variables', async () => {
  const { messages } = await setup();

  const added = find(messages, 'chat.sr.added');
  assert.deepEqual(added.params.sort(), ['position', 'title', 'user']);
  assert.equal(added.forms.length, 1);
  assert.equal(added.forms[0].form, null);

  const position = find(messages, 'chat.when.position');
  assert.deepEqual(position.forms.map((form) => form.leaf), ['chat.when.position_one', 'chat.when.position_other']);
  assert.ok(position.params.includes('count'));
  assert.equal(find(messages, 'chat.sr.added').enabled, true);
  assert.equal(messages.list().some((item) => !item.key.startsWith('chat.')), false);
});

test('un texto personalizado sustituye al original solo en su idioma y se puede restaurar', async () => {
  const { messages, t } = await setup();
  const added = 'chat.sr.added';

  assert.equal(messages.setText('es', added, '  ¡Anotada «{{title}}» para {{user}}, vas en el {{position}}!  '), true);
  assert.equal(t(added, { user: 'ana', title: 'Canción', position: 3 }), '¡Anotada «Canción» para ana, vas en el 3!');
  assert.equal(find(messages, added).forms[0].custom.es.startsWith('¡Anotada'), true);
  assert.equal(find(messages, added).forms[0].custom.en, undefined);
  assert.equal(messages.text('en', 'chat.sr.added'), find(messages, added).forms[0].defaults.en);

  assert.equal(messages.setText('es', added, ''), true);
  assert.match(t(added, { user: 'ana', title: 'Canción', position: 3 }), /añadida: es la número #3 en la lista/);
  assert.deepEqual(find(messages, added).forms[0].custom, {});
});

test('un texto igual al original no cuenta como personalizado y los saltos de línea se aplanan', async () => {
  const { messages } = await setup();
  const [form] = find(messages, 'chat.queue.empty').forms;

  assert.equal(messages.setText('es', form.leaf, form.defaults.es), true);
  assert.deepEqual(find(messages, 'chat.queue.empty').forms[0].custom, {});

  messages.setText('es', form.leaf, 'Línea uno\n\n   línea dos');
  assert.equal(messages.text('es', form.leaf), 'Línea uno línea dos');
});

test('cada forma de un plural se edita por separado', async () => {
  const { messages, t } = await setup();

  messages.setText('es', 'chat.limit.user_one', '@{{user}}, tu única petición sigue activa.');
  assert.equal(t('chat.limit.user', { user: 'ana', count: 1 }), '@ana, tu única petición sigue activa.');
  assert.match(t('chat.limit.user', { user: 'ana', count: 5 }), /ya tienes 5 peticiones activas/);
});

test('se rechazan textos largos, con variables ajenas o con otra sintaxis de i18next', async () => {
  const { messages, t } = await setup();
  const set = (text) => messages.setText('es', 'chat.sr.added', text);

  assert.equal(set('x'.repeat(MAX_LENGTH + 1)), false);
  assert.equal(set('Hola {{inventada}}'), false);
  assert.equal(set('Hola {{user, uppercase}}'), false);
  assert.equal(set('Hola {{- user}}'), false);
  assert.equal(set('Hola $t(chat.queue.empty)'), false);
  assert.equal(set('Hola {{user'), false);
  assert.equal(set('Hola user}}'), false);
  assert.equal(set(42), false);
  assert.equal(messages.setText('es', 'chat.no.existe', 'Hola'), false);
  assert.equal(messages.setText('fr', 'chat.sr.added', 'Hola'), false);
  assert.match(t('chat.sr.added', { user: 'ana', title: 'T', position: 1 }), /añadida: es la número #1 en la lista/);
  assert.equal(set('x'.repeat(MAX_LENGTH)), true);
});

test('un mensaje desactivado deja al traductor sin respuesta y se puede reactivar', async () => {
  const { messages, t } = await setup();

  assert.equal(messages.setEnabled('chat.sr.banned', false), true);
  assert.equal(t('chat.sr.banned', { user: 'ana' }), null);
  assert.equal(find(messages, 'chat.sr.banned').enabled, false);
  assert.match(t('chat.sr.usage', { user: 'ana' }), /usa !sr/);

  // Desactivar un plural silencia todas sus formas.
  messages.setEnabled('chat.when.position', false);
  assert.equal(t('chat.when.position', { user: 'ana', title: 'T', count: 2 }), null);

  assert.equal(messages.setEnabled('chat.sr.banned', true), true);
  assert.match(t('chat.sr.banned', { user: 'ana' }), /vetada/);
  assert.equal(messages.setEnabled('chat.no.existe', false), false);
  assert.equal(messages.setEnabled('chat.sr.banned', 'no'), false);
});

test('reset devuelve un mensaje a su texto original en todos los idiomas y lo reactiva', async () => {
  const { messages, t } = await setup();
  messages.setText('es', 'chat.sr.banned', 'Vetada, @{{user}}');
  messages.setText('en', 'chat.sr.banned', 'Banned, @{{user}}');
  messages.setEnabled('chat.sr.banned', false);

  assert.equal(messages.reset('chat.sr.banned'), true);
  assert.match(t('chat.sr.banned', { user: 'ana' }), /vetada/);
  assert.deepEqual(find(messages, 'chat.sr.banned').forms[0].custom, {});
  assert.equal(messages.reset('chat.no.existe'), false);
});

test('los cambios se guardan, se avisan y se recuperan al volver a abrir', async () => {
  const { kv, messages } = await setup();
  let changes = 0;
  messages.on('change', () => { changes += 1; });

  messages.setText('en', 'chat.sr.banned', 'Banned, @{{user}}');
  messages.setEnabled('chat.skip.nothing', false);
  assert.equal(changes, 2);

  const { messages: reopened, t } = await setup(kv);
  assert.equal(reopened.text('en', 'chat.sr.banned'), 'Banned, @{{user}}');
  assert.equal(reopened.isEnabled('chat.skip.nothing'), false);
  assert.equal(t('chat.skip.nothing'), null);
});

test('lo guardado que ya no es válido se descarta al cargar', async () => {
  const kv = createKv(openDatabase());
  kv.set('messages', {
    custom: { es: { 'chat.sr.banned': 'Hola {{inventada}}', 'chat.no.existe': 'x', 'chat.sr.usage': 'Bien {{user}}' }, fr: { 'chat.sr.usage': 'x' } },
    disabled: ['chat.no.existe', 'chat.queue.empty', 7],
  });

  const { messages } = await setup(kv);
  assert.equal(messages.text('es', 'chat.sr.banned').includes('inventada'), false);
  assert.equal(messages.text('es', 'chat.sr.usage'), 'Bien {{user}}');
  assert.equal(messages.isEnabled('chat.queue.empty'), false);
  assert.equal(messages.isEnabled('chat.no.existe'), true);
});

test('un traductor sin mensajes personalizables sigue funcionando', async () => {
  const t = await createTranslator('en');
  assert.match(t('chat.sr.usage', { user: 'ana' }), /use !sr/i);
});
