import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout } from '../server/widget/layout.js';
import { TEMPLATES } from '../public/js/widget/templates.js';
import {
  addElement,
  alignElement,
  bounds,
  createHistory,
  duplicateElement,
  hitTest,
  moveLayer,
  removeElement,
  resizeBox,
  rotationTowards,
  snapMove,
  updateElement,
} from '../public/js/widget/editor-model.js';

const classic = () => normalizeLayout(TEMPLATES[0]);
const ids = (layout) => layout.elements.map((element) => element.id);
const element = (extra = {}) => ({ x: 100, y: 50, width: 80, height: 40, rotation: 0, visible: true, locked: false, ...extra });

test('addElement crea elementos válidos de cada tipo, centrados y con id único', () => {
  let layout = classic();
  for (const type of ['text', 'progress', 'disc', 'box', 'text']) {
    const added = addElement(layout, type);
    assert.ok(added, type);
    layout = added.layout;
    assert.equal(layout.elements.at(-1).id, added.id);
  }

  assert.equal(ids(layout).at(-1), 'text-2');
  assert.equal(new Set(ids(layout)).size, layout.elements.length);
  assert.deepEqual(normalizeLayout(layout)?.elements, layout.elements);
  assert.equal(addElement(layout, 'script'), null);

  const box = layout.elements.find((item) => item.id === 'box-1');
  assert.equal(box.x, Math.round((600 - box.width) / 2));
});

test('addElement y duplicateElement respetan el máximo de elementos', () => {
  let layout = classic();
  while (layout.elements.length < 40) layout = addElement(layout, 'box').layout;

  assert.equal(addElement(layout, 'box'), null);
  assert.equal(duplicateElement(layout, 'title'), null);
});

test('las operaciones no modifican el layout original', () => {
  const layout = classic();
  const before = structuredClone(layout);

  updateElement(layout, 'title', { x: 1, fill: { type: 'solid' } });
  removeElement(layout, 'title');
  moveLayer(layout, 'title', 0);
  alignElement(layout, 'title', 'right');
  duplicateElement(layout, 'title');

  assert.deepEqual(layout, before);
});

test('duplicateElement pone la copia justo encima, desplazada, y moveLayer reordena', () => {
  const { layout, id } = duplicateElement(classic(), 'title');

  assert.equal(id, 'text-1');
  assert.deepEqual(ids(layout).slice(1, 5), ['disc', 'title', 'text-1', 'meta']);
  const [source, copy] = [layout.elements[2], layout.elements[3]];
  assert.deepEqual([copy.x, copy.y, copy.template], [source.x + 12, source.y + 12, source.template]);

  assert.deepEqual(ids(moveLayer(layout, 'text-1', 0)).slice(0, 2), ['text-1', 'background']);
  assert.equal(ids(moveLayer(layout, 'text-1', 99)).at(-1), 'text-1');
  assert.equal(moveLayer(layout, 'no-existe', 0), layout);
});

test('alignElement pega el elemento a un borde o al centro del lienzo', () => {
  const layout = classic();
  const at = (target) => {
    const { x, y } = alignElement(layout, 'disc', target).elements.find((item) => item.id === 'disc');
    return [x, y];
  };

  assert.deepEqual(at('left'), [0, 38]);
  assert.deepEqual(at('right'), [536, 38]);
  assert.deepEqual(at('hcenter'), [268, 38]);
  assert.deepEqual(at('top'), [18, 0]);
  assert.deepEqual(at('bottom'), [18, 76]);
  assert.deepEqual(at('vcenter'), [18, 38]);
  assert.equal(alignElement(layout, 'disc', 'diagonal'), layout);
});

test('bounds envuelve al elemento girado', () => {
  assert.deepEqual(bounds(element()), { left: 100, top: 50, right: 180, bottom: 90 });

  const turned = bounds(element({ rotation: 90 }));
  assert.deepEqual([turned.left, turned.top, turned.right, turned.bottom].map(Math.round), [120, 30, 160, 110]);
});

test('hitTest elige el elemento más alto, y salta los ocultos, los bloqueados y los que están fuera', () => {
  const layout = classic();

  assert.equal(hitTest(layout, 120, 20), 'title');
  assert.equal(hitTest(layout, 40, 70), 'disc');
  assert.equal(hitTest(layout, 5, 5), 'background');
  assert.equal(hitTest(layout, 700, 5), null);

  assert.equal(hitTest(updateElement(layout, 'disc', { visible: false }), 40, 70), 'background');
  assert.equal(hitTest(updateElement(layout, 'disc', { locked: true }), 40, 70), 'background');

  // Un elemento girado 90° ocupa el rectángulo girado, no el original.
  const turned = { elements: [{ id: 't', ...element({ rotation: 90 }) }] };
  assert.equal(hitTest(turned, 140, 35), 't');
  assert.equal(hitTest(turned, 110, 70), null);
});

test('resizeBox deja quieto el lado opuesto al tirador, también con el elemento girado', () => {
  const base = element();
  assert.deepEqual(resizeBox(base, 'e', 10, 99), { x: 100, y: 50, width: 90, height: 40 });
  assert.deepEqual(resizeBox(base, 'w', -10, 0), { x: 90, y: 50, width: 90, height: 40 });
  assert.deepEqual(resizeBox(base, 'nw', -10, -5), { x: 90, y: 45, width: 90, height: 45 });
  assert.deepEqual(resizeBox(base, 'se', 4, 6), { x: 100, y: 50, width: 84, height: 46 });
  assert.deepEqual(resizeBox(base, 'e', -500, 0), { x: 100, y: 50, width: 4, height: 40 });

  // Girado 90°, arrastrar hacia abajo (eje y del lienzo) estira el ancho por el borde derecho local.
  const turned = element({ rotation: 90 });
  const grown = resizeBox(turned, 'e', 0, 10);
  assert.equal(grown.width, 90);
  assert.equal(grown.height, 40);

  // El borde izquierdo local, que queda arriba al girar 90°, no se mueve.
  const topEdge = (box) => box.y + box.height / 2 - box.width / 2;
  assert.equal(topEdge({ ...turned, ...grown }), topEdge(turned));
});

test('rotationTowards apunta el tirador de giro (encima del elemento) hacia el puntero', () => {
  const box = element();

  assert.equal(rotationTowards(box, 140, 20), 0);
  assert.equal(rotationTowards(box, 190, 70), 90);
  assert.equal(rotationTowards(box, 140, 120), 180);
  assert.equal(rotationTowards(box, 90, 70), -90);
  assert.equal(rotationTowards(box, 190, 30, 15), 45);
});

test('snapMove acerca bordes y centros a los del lienzo y de otros elementos, y devuelve las guías', () => {
  const canvas = { width: 600, height: 140 };
  const other = { left: 200, top: 20, right: 300, bottom: 60 };

  const toEdge = snapMove({ left: 3, top: 40, right: 83, bottom: 80 }, [], canvas, 6);
  assert.deepEqual(toEdge, { dx: -3, dy: 0, guides: [{ axis: 'x', position: 0 }] });

  const toCenter = snapMove({ left: 262, top: 49, right: 342, bottom: 89 }, [], canvas, 6);
  assert.deepEqual([toCenter.dx, toCenter.dy], [-2, 1]);
  assert.equal(toCenter.guides.length, 2);

  const toOther = snapMove({ left: 303, top: 100, right: 363, bottom: 130 }, [other], canvas, 6);
  assert.deepEqual([toOther.dx, toOther.dy], [-3, 0]);

  assert.deepEqual(snapMove({ left: 20, top: 20, right: 80, bottom: 60 }, [], canvas, 6), { dx: 0, dy: 0, guides: [] });
});

test('el historial deshace, rehace, ignora repetidos y descarta lo rehecho al anotar', () => {
  const history = createHistory('a');
  assert.equal(history.canUndo, false);

  assert.equal(history.push('b'), true);
  assert.equal(history.push('b'), false);
  history.push('c');
  assert.deepEqual([history.canUndo, history.canRedo, history.current], [true, false, 'c']);

  assert.equal(history.undo(), 'b');
  assert.equal(history.canRedo, true);
  history.push('d');
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), 'b');
  assert.equal(history.undo(), 'a');
  assert.equal(history.undo(), 'a');
  assert.equal(history.redo(), 'b');

  history.reset('z');
  assert.deepEqual([history.current, history.canUndo], ['z', false]);
});

test('el historial guarda como mucho `limit` estados', () => {
  const history = createHistory('0', 3);
  for (const state of ['1', '2', '3', '4']) history.push(state);

  assert.equal(history.undo(), '3');
  assert.equal(history.undo(), '2');
  assert.equal(history.undo(), '2');
});
