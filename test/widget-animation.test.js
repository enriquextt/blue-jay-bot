import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../server/app.js';
import { normalizeLayout } from '../server/widget/layout.js';
import { ANIMATION_TEMPLATES, ANIMATION_TEMPLATE_IDS, applyAnimationTemplate } from '../public/js/widget/animation-templates.js';
import { animationDefaults, EASINGS, ENTER_PRESETS, LOOP_PRESETS } from '../public/js/widget/catalog.js';
import { addElement } from '../public/js/widget/editor-model.js';
import { TEMPLATES } from '../public/js/widget/templates.js';

const element = (extra = {}) => ({ id: 'a', type: 'box', x: 0, y: 0, width: 100, height: 50, ...extra });
const layout = (elements) => ({ name: 'Mío', canvas: { width: 400, height: 100 }, elements });
const normalize = (extra) => normalizeLayout(layout([element(extra)]))?.elements[0] ?? null;

test('sin animación se aplican los valores por defecto, y solo el disco gira', () => {
  assert.deepEqual(normalize({}).animation, animationDefaults('box'));
  assert.deepEqual(normalize({}).animation.loop, { preset: 'none', duration: 3000 });
  assert.deepEqual(normalize({ type: 'disc' }).animation.loop, { preset: 'spin', duration: 3000 });
});

test('una animación parcial se completa y se reconstruye sin campos desconocidos', () => {
  const clean = normalize({
    animation: {
      in: { preset: 'slide-left', delay: 200, css: 'x' },
      loop: { preset: 'pulse', duration: 1500 },
      extra: 1,
    },
  });

  assert.deepEqual(clean.animation.in, { preset: 'slide-left', duration: 500, delay: 200, easing: 'ease-out' });
  assert.deepEqual(clean.animation.out, { preset: 'none', duration: 500, delay: 0, easing: 'ease-out' });
  assert.deepEqual(clean.animation.loop, { preset: 'pulse', duration: 1500 });
  assert.deepEqual(Object.keys(clean.animation).sort(), ['in', 'loop', 'out']);
});

test('todos los presets del catálogo se aceptan y lo demás se rechaza', () => {
  for (const preset of ENTER_PRESETS) {
    assert.ok(normalize({ animation: { in: { preset }, out: { preset } } }), preset);
  }
  for (const preset of LOOP_PRESETS) assert.ok(normalize({ animation: { loop: { preset } } }), preset);
  for (const easing of Object.keys(EASINGS)) assert.ok(normalize({ animation: { in: { preset: 'fade', easing } } }), easing);

  const invalid = [
    { animation: { in: { preset: 'explode' } } },
    { animation: { in: { preset: 'spin' } } },
    { animation: { loop: { preset: 'fade' } } },
    { animation: { in: { preset: '__proto__' } } },
    { animation: { in: { easing: 'cubic-bezier(0,0,0,0)' } } },
    { animation: { in: { easing: 'toString' } } },
    { animation: { in: { duration: 10 } } },
    { animation: { in: { duration: 6000 } } },
    { animation: { out: { delay: -1 } } },
    { animation: { loop: { duration: 100 } } },
    { animation: { loop: { duration: 'rápido' } } },
    { animation: 'fade' },
    { animation: { in: 'fade' } },
  ];
  for (const extra of invalid) assert.equal(normalize(extra), null, JSON.stringify(extra));
});

test('los elementos nuevos del editor ya llevan su animación por defecto y son válidos', () => {
  let current = normalizeLayout(layout([]));
  for (const type of ['text', 'progress', 'disc', 'box', 'image']) {
    current = addElement(current, type).layout;
    assert.deepEqual(current.elements.at(-1).animation, animationDefaults(type), type);
  }
  assert.deepEqual(normalizeLayout(current).elements, current.elements);
});

test('cada preset y cada bucle del catálogo tienen sus reglas y fotogramas en widget-render.css', async () => {
  const css = await readFile(fileURLToPath(new URL('../public/css/widget-render.css', import.meta.url)), 'utf8');

  for (const preset of ENTER_PRESETS.filter((name) => name !== 'none')) {
    assert.ok(css.includes(`[data-in="${preset}"]`), `entrada ${preset}`);
    assert.ok(css.includes(`[data-out="${preset}"]`), `salida ${preset}`);
    if (preset !== 'typewriter') assert.ok(css.includes(`@keyframes bj-${preset} `), `fotogramas ${preset}`);
  }
  for (const preset of LOOP_PRESETS.filter((name) => name !== 'none')) {
    assert.ok(css.includes(`[data-loop="${preset}"]`), `bucle ${preset}`);
    assert.ok(css.includes(`@keyframes bj-loop-${preset} `), `fotogramas del bucle ${preset}`);
  }
});

test('una plantilla de animación escalona la entrada, invierte la salida y respeta el bucle', () => {
  const base = normalizeLayout(TEMPLATES[0]).elements;
  const result = applyAnimationTemplate(base, 'slide-stagger');

  assert.deepEqual(result.map((item) => item.animation.in.delay), base.map((_, index) => index * 80));
  assert.deepEqual(result.map((item) => item.animation.out.delay), base.map((_, index) => Math.round((base.length - 1 - index) * 48)));
  assert.equal(result[0].animation.in.preset, 'slide-left');
  assert.equal(result[0].animation.out.preset, 'slide-right');
  assert.equal(result.find((item) => item.type === 'disc').animation.loop.preset, 'spin');
  assert.equal(normalizeLayout(layout(result.map((item, index) => ({ ...item, id: `e${index}` })))) !== null, true);

  assert.equal(applyAnimationTemplate(base, 'no-existe'), base);
  assert.equal(base[0].animation.in.preset, 'none');
  for (const id of ANIMATION_TEMPLATE_IDS) {
    const applied = applyAnimationTemplate(base, id);
    assert.ok(normalizeLayout(layout(applied.map((item, index) => ({ ...item, id: `e${index}` })))), id);
  }
  assert.equal(applyAnimationTemplate(base, 'none').every((item) => item.animation.in.preset === 'none'), true);
  assert.ok(Object.keys(ANIMATION_TEMPLATES).length >= 5);
});

test('los layouts de serie son válidos, distintos y enseñan formas y animaciones', () => {
  assert.deepEqual(TEMPLATES.map((template) => template.id), ['classic', 'compact', 'bar', 'big-disc', 'corner-banner', 'semicircle']);

  for (const template of TEMPLATES) {
    const clean = normalizeLayout(template);
    assert.ok(clean, template.id);
    assert.equal(new Set(clean.elements.map((item) => item.id)).size, clean.elements.length, template.id);
    // Todo lo que se ve cabe en el lienzo.
    for (const item of clean.elements) {
      assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.width <= clean.canvas.width && item.y + item.height <= clean.canvas.height, `${template.id}/${item.id}`);
    }
  }

  const shapes = TEMPLATES.flatMap((template) => normalizeLayout(template).elements).filter((item) => item.shape).map((item) => item.shape.type);
  assert.ok(shapes.includes('triangle-corner') && shapes.includes('semicircle'));
  // El Clásico no cambia con respecto a la fase 6: sin animaciones de entrada ni salida y con el disco girando.
  const [classic, ...others] = TEMPLATES.map((template) => normalizeLayout(template));
  assert.equal(classic.elements.every((item) => item.animation.in.preset === 'none' && item.animation.out.preset === 'none'), true);
  assert.equal(others.every((template) => template.elements.some((item) => item.animation.in.preset !== 'none')), true);
});

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    const waiters = [];
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
      for (const waiter of waiters.splice(0)) waiter();
    });
    socket.on('open', () => resolve({ socket, messages, waitFor }));
    socket.on('error', reject);

    function waitFor(predicate) {
      return new Promise((done) => {
        const check = () => {
          const found = messages.find(predicate);
          if (found) return done(found);
          waiters.push(check);
        };
        check();
      });
    }
  });
}

test('widget.test con un borrador lo valida y lo envía solo a los widgets, sin guardarlo', async () => {
  const server = await createServer({ host: '127.0.0.1', port: 0 });
  const { port } = server.app.server.address();
  const url = `ws://127.0.0.1:${port}/ws`;
  const panel = await connect(url);
  const widget = await connect(`${url}?view=widget`);
  const send = (message) => panel.socket.send(JSON.stringify(message));
  const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const draft = { name: 'Borrador', canvas: { width: 300, height: 80 }, elements: [element({ id: 'x', animation: { in: { preset: 'zoom' } } })] };
    send({ type: 'widget.test', layout: draft });
    const message = await widget.waitFor((m) => m.type === 'widget.test');

    assert.equal(message.data.duration, 8);
    assert.equal(message.data.layout.name, 'Borrador');
    assert.equal(message.data.layout.elements[0].animation.in.preset, 'zoom');
    assert.equal(message.data.layout.elements[0].animation.in.duration, 500);

    // Sin borrador, la prueba de siempre.
    send({ type: 'widget.test' });
    await widget.waitFor((m) => m.type === 'widget.test' && m !== message);
    assert.equal(widget.messages.filter((m) => m.type === 'widget.test').at(-1).data.layout, undefined);

    send({ type: 'widget.test', layout: { ...draft, name: '' } });
    send({ type: 'widget.test', layout: 'no soy un layout' });
    await pause();
    assert.equal(panel.messages.filter((m) => m.type === 'error' && m.key === 'errors.layoutInvalid').length, 2);
    assert.equal(widget.messages.filter((m) => m.type === 'widget.test').length, 2);

    // No se guarda: el widget sigue con el layout activo y la lista de layouts no cambia.
    assert.equal(widget.messages.filter((m) => m.type === 'widget.layout').length, 1);
    assert.equal(panel.messages.findLast((m) => m.type === 'widget.layouts').data.layouts.some((layout) => layout.name === 'Borrador'), false);
    assert.equal(panel.messages.some((m) => m.type === 'widget.test'), false);
  } finally {
    panel.socket.close();
    widget.socket.close();
    await server.close();
  }
});
