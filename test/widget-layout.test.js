import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db/database.js';
import { createKv } from '../server/db/kv.js';
import { normalizeLayout } from '../server/widget/layout.js';
import { WidgetLayouts } from '../server/widget/layouts.js';
import { fillTemplate, formatTime, templateValues } from '../public/js/widget/format.js';
import { CLASSIC_ID, TEMPLATES } from '../public/js/widget/templates.js';

const box = (extra = {}) => ({ id: 'bg', type: 'box', x: 0, y: 0, width: 100, height: 50, ...extra });
const layout = (extra = {}) => ({ name: 'Mío', canvas: { width: 400, height: 100 }, elements: [box()], ...extra });

function setup() {
  const kv = createKv(openDatabase());
  return { kv, layouts: new WidgetLayouts({ kv }) };
}

test('el layout Clásico es válido y completa los valores que faltan', () => {
  const classic = normalizeLayout(TEMPLATES.find((template) => template.id === CLASSIC_ID));

  assert.ok(classic);
  assert.equal(classic.elements.length, 7);
  const title = classic.elements.find((element) => element.id === 'title');
  assert.deepEqual(
    { ...title },
    {
      id: 'title', type: 'text', x: 98, y: 12, width: 484, height: 52, visible: true, locked: false, rotation: 0, opacity: 1,
      template: '{title}', color: '#ffffff', fontSize: 20, fontWeight: 700, align: 'left', valign: 'bottom', maxLines: 2,
    },
  );
});

test('normalizeLayout descarta campos desconocidos y no deja pasar CSS ni valores fuera del catálogo', () => {
  const clean = normalizeLayout(layout({ extra: 1, elements: [box({ evil: 'x', shape: { type: 'rect', radius: 4, css: 'x' } })] }));
  assert.ok(clean);
  assert.equal('extra' in clean, false);
  assert.equal('evil' in clean.elements[0], false);
  assert.deepEqual(clean.elements[0].shape, { type: 'rect', radius: 4, variant: null });

  const invalid = [
    layout({ name: '   ' }),
    layout({ name: 'x'.repeat(61) }),
    layout({ canvas: { width: 10, height: 100 } }),
    layout({ canvas: { width: 400.5, height: 100 } }),
    layout({ showSeconds: 0 }),
    layout({ idleOpacity: 2 }),
    layout({ elements: 'no' }),
    layout({ elements: Array.from({ length: 41 }, (_, i) => box({ id: `e${i}` })) }),
    layout({ elements: [box(), box()] }),
    layout({ elements: [box({ id: 'a b' })] }),
    layout({ elements: [box({ type: 'script' })] }),
    layout({ elements: [box({ x: Infinity })] }),
    layout({ elements: [box({ width: 0 })] }),
    layout({ elements: [box({ opacity: 1.5 })] }),
    layout({ elements: [box({ fill: { type: 'solid', color: 'red' } })] }),
    layout({ elements: [box({ fill: { type: 'solid', color: 'url(javascript:x)' } })] }),
    layout({ elements: [box({ shape: { type: 'star' } })] }),
    layout({ elements: [{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, template: 'a\nb' }] }),
    layout({ elements: [{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, template: 'x'.repeat(201) }] }),
    layout({ elements: [{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, fontWeight: 650 }] }),
    layout({ elements: [{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, maxLines: 1.5 }] }),
    null,
    [],
  ];
  for (const input of invalid) assert.equal(normalizeLayout(input), null, JSON.stringify(input)?.slice(0, 80));
});

test('los layouts de serie vienen siempre, son de solo lectura y el activo por defecto es el Clásico', () => {
  const { layouts } = setup();

  assert.equal(layouts.activeId(), CLASSIC_ID);
  assert.deepEqual(layouts.list().map(({ id, builtin }) => [id, builtin]), [[CLASSIC_ID, true]]);
  assert.equal(layouts.remove(CLASSIC_ID), false);
  assert.equal(layouts.resolve().id, CLASSIC_ID);
});

test('save crea y reemplaza layouts propios; guardar sobre uno de serie crea una copia', () => {
  const { layouts } = setup();
  let changes = 0;
  layouts.on('change', () => { changes += 1; });

  const created = layouts.save(layout());
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.builtin, false);

  const updated = layouts.save({ ...layout({ name: 'Otro' }), id: created.id });
  assert.equal(updated.id, created.id);
  assert.equal(layouts.list().filter((item) => !item.builtin).length, 1);
  assert.equal(layouts.get(created.id).name, 'Otro');

  const copy = layouts.save({ ...layout(), id: CLASSIC_ID });
  assert.notEqual(copy.id, CLASSIC_ID);
  assert.equal(layouts.get(CLASSIC_ID).name, 'Clásico');
  assert.equal(changes, 3);

  assert.equal(layouts.save(layout({ name: '' })), null);
  assert.equal(changes, 3);
});

test('hay un tope de layouts propios', () => {
  const { layouts } = setup();
  for (let i = 0; i < 30; i += 1) assert.ok(layouts.save(layout({ name: `L${i}` })));

  assert.equal(layouts.save(layout()), null);
  const first = layouts.list().find((item) => !item.builtin);
  assert.ok(layouts.save({ ...layout(), id: first.id }));
});

test('duplicate copia un layout, también uno de serie, con otro nombre', () => {
  const { layouts } = setup();

  const copy = layouts.duplicate(CLASSIC_ID, 'Clásico (copia)');
  assert.equal(copy.name, 'Clásico (copia)');
  assert.equal(copy.builtin, false);
  assert.deepEqual(copy.elements, layouts.get(CLASSIC_ID).elements);
  assert.equal(layouts.duplicate('no-existe', 'x'), null);
  assert.equal(layouts.duplicate(CLASSIC_ID, ''), null);
});

test('activate y remove: borrar el layout activo devuelve al Clásico; resolve usa el activo si el pedido no existe', () => {
  const { layouts } = setup();
  const mine = layouts.save(layout());

  assert.equal(layouts.activate('no-existe'), false);
  assert.equal(layouts.activate(mine.id), true);
  assert.equal(layouts.resolve().id, mine.id);
  assert.equal(layouts.resolve(CLASSIC_ID).id, CLASSIC_ID);
  assert.equal(layouts.resolve('no-existe').id, mine.id);

  assert.equal(layouts.remove(mine.id), true);
  assert.equal(layouts.activeId(), CLASSIC_ID);
  assert.equal(layouts.remove(mine.id), false);
});

test('lo guardado se conserva al volver a abrir y se descarta lo dañado', () => {
  const { kv, layouts } = setup();
  const mine = layouts.save(layout());
  layouts.activate(mine.id);

  const reopened = new WidgetLayouts({ kv });
  assert.equal(reopened.activeId(), mine.id);
  assert.equal(reopened.get(mine.id).name, 'Mío');

  kv.set('widget.layouts', [
    { id: mine.id, ...layout() },
    { id: 'malo', ...layout({ canvas: { width: 1, height: 1 } }) },
    { id: CLASSIC_ID, ...layout({ name: 'Intruso' }) },
    { id: mine.id, ...layout({ name: 'Repetido' }) },
  ]);
  kv.set('widget.active', 'borrado');
  const damaged = new WidgetLayouts({ kv });
  assert.deepEqual(damaged.list().map((item) => item.id), [CLASSIC_ID, mine.id]);
  assert.equal(damaged.get(CLASSIC_ID).name, 'Clásico');
  assert.equal(damaged.activeId(), CLASSIC_ID);

  kv.set('widget.layouts', 'no es una lista');
  assert.deepEqual(new WidgetLayouts({ kv }).list().map((item) => item.id), [CLASSIC_ID]);
});

test('fillTemplate sustituye variables conocidas, deja las desconocidas y vacía las sin valor', () => {
  const values = templateValues({ title: 'Canción', artist: 'Alguien', requester: 'pedida por ana', position: 65, duration: 200 });

  assert.equal(fillTemplate('{title} - {artist}', values), 'Canción - Alguien');
  assert.equal(fillTemplate('{meta}', values), 'Alguien · pedida por ana');
  assert.equal(fillTemplate('{position}/{duration} {remaining}', values), '1:05/3:20 -2:15');
  assert.equal(fillTemplate('{nada} {__proto__}', values), '{nada} {__proto__}');
  assert.equal(fillTemplate('<b>{title}</b>', values), '<b>Canción</b>');

  const bare = templateValues({ title: 'Solo', position: 3, duration: 0 });
  assert.equal(fillTemplate('[{artist}][{requester}][{meta}][{duration}][{remaining}]', bare), '[][][][][]');
});

test('formatTime da m:ss y h:mm:ss', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(75.9), '1:15');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-4), '0:00');
});
