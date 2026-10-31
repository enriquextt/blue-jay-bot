import { HANDLES, bounds, hitTest, resizeBox, rotationTowards, snapMove, updateElement } from './widget/editor-model.js';
import { createRenderer } from './widget/render.js';

const SNAP_PIXELS = 6;
const ROTATE_STEP = 15;

function node(className, parent) {
  const element = document.createElement('div');
  element.className = className;
  parent?.append(element);
  return element;
}

// Lienzo del editor: el widget dibujado con el mismo renderizador que usa OBS, con una capa encima para
// seleccionar, mover, redimensionar y girar. Los cambios no se aplican aquí: se piden con `onGesture(layout)`
// mientras se arrastra y `onGestureEnd()` al soltar, y quien edita vuelve a llamar a `show`.
export function createCanvas({ root, onSelect, onGesture, onGestureEnd }) {
  const renderer = createRenderer(root);
  const overlay = node('we-overlay', root);

  let layout = null;
  let selectedId = null;
  let shownLayout = null;
  let view = null;
  let gesture = null;
  let guides = [];

  const scale = () => root.clientWidth / layout.canvas.width;

  function toCanvas(event) {
    const rect = root.getBoundingClientRect();
    const factor = layout.canvas.width / rect.width;
    return { x: (event.clientX - rect.left) * factor, y: (event.clientY - rect.top) * factor };
  }

  function drawOverlay() {
    overlay.replaceChildren();
    if (!layout || root.clientWidth === 0) return;

    overlay.style.width = `${layout.canvas.width}px`;
    overlay.style.height = `${layout.canvas.height}px`;
    overlay.style.transform = `scale(${scale()})`;
    overlay.style.setProperty('--inverse', String(1 / scale()));

    const selected = layout.elements.find((element) => element.id === selectedId);
    if (selected) {
      const box = node(`we-selection${selected.locked ? ' locked' : ''}`, overlay);
      Object.assign(box.style, {
        left: `${selected.x}px`,
        top: `${selected.y}px`,
        width: `${selected.width}px`,
        height: `${selected.height}px`,
        transform: `rotate(${selected.rotation}deg)`,
      });
      if (!selected.locked) {
        for (const name of [...Object.keys(HANDLES), 'rotate']) {
          const handle = node(`we-handle ${name}`, box);
          handle.dataset.handle = name;
        }
      }
    }

    for (const { axis, position } of guides) {
      const line = node(`we-guide ${axis}`, overlay);
      line.style[axis === 'x' ? 'left' : 'top'] = `${position}px`;
    }
  }

  function draw() {
    if (!layout) return;

    root.style.aspectRatio = `${layout.canvas.width} / ${layout.canvas.height}`;
    if (layout !== shownLayout) {
      renderer.setLayout(layout);
      shownLayout = layout;
    }
    renderer.update(view, { shown: true });
    renderer.fit();
    drawOverlay();
  }

  // Cada gesto parte del layout y del elemento tal como estaban al pulsar; así los redondeos no se acumulan.
  function start(event) {
    if (event.button !== 0 || !layout) return;

    const point = toCanvas(event);
    const selected = layout.elements.find((element) => element.id === selectedId);
    const handle = event.target.dataset?.handle;

    let kind;
    let target = selected;
    if (handle && selected) {
      kind = handle === 'rotate' ? 'rotate' : 'resize';
    } else {
      const id = hitTest(layout, point.x, point.y);
      onSelect(id);
      target = layout.elements.find((element) => element.id === id);
      if (!target) return;
      kind = 'move';
    }

    gesture = { kind, handle, origin: point, layout, element: structuredClone(target) };
    overlay.setPointerCapture(event.pointerId);
    root.focus({ preventScroll: true });
    event.preventDefault();
  }

  function move(event) {
    if (!gesture) return;

    const point = toCanvas(event);
    const { kind, handle, origin, element } = gesture;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    let patch;

    if (kind === 'resize') {
      patch = resizeBox(element, handle, dx, dy);
      guides = [];
    } else if (kind === 'rotate') {
      patch = { rotation: rotationTowards(element, point.x, point.y, event.shiftKey ? ROTATE_STEP : 0) };
      guides = [];
    } else {
      let x = element.x + dx;
      let y = element.y + dy;
      guides = [];
      if (!event.altKey) {
        const others = gesture.layout.elements.filter((other) => other.id !== element.id && other.visible).map(bounds);
        const snap = snapMove(bounds({ ...element, x, y }), others, gesture.layout.canvas, SNAP_PIXELS / scale());
        x += snap.dx;
        y += snap.dy;
        guides = snap.guides;
      }
      patch = { x: Math.round(x), y: Math.round(y) };
    }

    onGesture(updateElement(gesture.layout, element.id, patch));
  }

  function end(event) {
    if (!gesture) return;

    // El último movimiento puede llegar junto con el soltar: se aplica antes de cerrar el gesto.
    if (event.type === 'pointerup') move(event);
    gesture = null;
    guides = [];
    onGestureEnd();
  }

  overlay.addEventListener('pointerdown', start);
  overlay.addEventListener('pointermove', move);
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
  new ResizeObserver(draw).observe(root);

  return {
    // Dibuja `nextLayout` con `nextView` (los valores de ejemplo) y la selección indicada.
    show(nextLayout, nextSelectedId, nextView) {
      layout = nextLayout;
      selectedId = nextSelectedId;
      view = nextView;
      draw();
    },
  };
}
