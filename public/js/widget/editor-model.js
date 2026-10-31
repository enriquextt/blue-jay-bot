import { COMMON_DEFAULTS, ELEMENT_TYPES, LIMITS, TYPE_DEFAULTS } from './catalog.js';

// Operaciones del editor sobre un layout: funciones puras que devuelven un layout nuevo (o la información
// que hace falta para dibujar), sin DOM, para poder probarlas y para que deshacer sea guardar copias.

const MIN_SIZE = 4;
const DEFAULT_SIZES = { text: [240, 30], progress: [300, 8], disc: [64, 64], box: [120, 60] };
const DUPLICATE_OFFSET = 12;
const HISTORY_LIMIT = 100;

// Dirección en la que crece cada tirador de tamaño: -1 es hacia la izquierda o arriba, 1 hacia la derecha o abajo.
export const HANDLES = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

const radians = (degrees) => (degrees * Math.PI) / 180;

export function canAddElement(layout) {
  return layout.elements.length < LIMITS.elements;
}

function newId(layout, base) {
  const used = new Set(layout.elements.map((element) => element.id));
  for (let n = 1; ; n += 1) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

// Un elemento nuevo del tipo pedido, centrado en el lienzo y con los valores por defecto del catálogo.
export function createElement(layout, type) {
  if (!ELEMENT_TYPES.includes(type)) return null;

  const [width, height] = DEFAULT_SIZES[type];
  return structuredClone({
    id: newId(layout, type),
    type,
    x: Math.max(0, Math.round((layout.canvas.width - width) / 2)),
    y: Math.max(0, Math.round((layout.canvas.height - height) / 2)),
    width,
    height,
    ...COMMON_DEFAULTS,
    ...TYPE_DEFAULTS[type],
  });
}

const withElements = (layout, elements) => ({ ...layout, elements });

// Añade un elemento encima de todos. Devuelve `{ layout, id }`, o null si no cabe o el tipo no existe.
export function addElement(layout, type) {
  if (!canAddElement(layout)) return null;

  const element = createElement(layout, type);
  return element && { layout: withElements(layout, [...layout.elements, element]), id: element.id };
}

export function updateElement(layout, id, patch) {
  return withElements(layout, layout.elements.map((element) => (element.id === id ? { ...element, ...structuredClone(patch) } : element)));
}

export function removeElement(layout, id) {
  return withElements(layout, layout.elements.filter((element) => element.id !== id));
}

// Copia un elemento justo encima del original, algo desplazado. Devuelve `{ layout, id }` o null.
export function duplicateElement(layout, id) {
  const index = layout.elements.findIndex((element) => element.id === id);
  if (index === -1 || !canAddElement(layout)) return null;

  const source = layout.elements[index];
  const copy = { ...structuredClone(source), id: newId(layout, source.type), x: source.x + DUPLICATE_OFFSET, y: source.y + DUPLICATE_OFFSET };
  const elements = [...layout.elements];
  elements.splice(index + 1, 0, copy);
  return { layout: withElements(layout, elements), id: copy.id };
}

// Cambia la posición de un elemento en la lista (el orden es el eje Z: el último queda encima).
export function moveLayer(layout, id, toIndex) {
  const index = layout.elements.findIndex((element) => element.id === id);
  if (index === -1) return layout;

  const elements = [...layout.elements];
  const [element] = elements.splice(index, 1);
  elements.splice(Math.min(Math.max(toIndex, 0), elements.length), 0, element);
  return withElements(layout, elements);
}

const ALIGNMENTS = {
  left: () => ({ x: 0 }),
  hcenter: (element, canvas) => ({ x: Math.round((canvas.width - element.width) / 2) }),
  right: (element, canvas) => ({ x: canvas.width - element.width }),
  top: () => ({ y: 0 }),
  vcenter: (element, canvas) => ({ y: Math.round((canvas.height - element.height) / 2) }),
  bottom: (element, canvas) => ({ y: canvas.height - element.height }),
};

export const ALIGN_TARGETS = Object.keys(ALIGNMENTS);

// Pega un elemento a un borde o al centro del lienzo (sin tener en cuenta la rotación).
export function alignElement(layout, id, target) {
  const element = layout.elements.find((item) => item.id === id);
  const align = ALIGNMENTS[target];
  return element && align ? updateElement(layout, id, align(element, layout.canvas)) : layout;
}

// Rectángulo que envuelve al elemento una vez girado, en coordenadas del lienzo.
export function bounds({ x, y, width, height, rotation = 0 }) {
  const cos = Math.abs(Math.cos(radians(rotation)));
  const sin = Math.abs(Math.sin(radians(rotation)));
  const halfWidth = (width * cos + height * sin) / 2;
  const halfHeight = (width * sin + height * cos) / 2;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return { left: centerX - halfWidth, top: centerY - halfHeight, right: centerX + halfWidth, bottom: centerY + halfHeight };
}

export function center({ x, y, width, height }) {
  return { x: x + width / 2, y: y + height / 2 };
}

// El elemento visible y desbloqueado más alto que contiene el punto, o null.
export function hitTest(layout, pointX, pointY) {
  for (const element of [...layout.elements].reverse()) {
    if (!element.visible || element.locked) continue;

    const { x, y } = center(element);
    const rad = radians(element.rotation);
    const dx = pointX - x;
    const dy = pointY - y;
    // El punto en los ejes del elemento: se deshace su giro.
    const localX = dx * Math.cos(rad) + dy * Math.sin(rad);
    const localY = -dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(localX) <= element.width / 2 && Math.abs(localY) <= element.height / 2) return element.id;
  }
  return null;
}

// Redimensiona arrastrando un tirador `(dx, dy)` unidades del lienzo. El lado opuesto se queda quieto aunque el
// elemento esté girado: el arrastre se pasa a los ejes del elemento y el centro se desplaza la mitad del cambio.
export function resizeBox(element, handle, dx, dy) {
  const [hx, hy] = HANDLES[handle];
  const rad = radians(element.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;

  const width = hx === 0 ? element.width : Math.max(MIN_SIZE, element.width + hx * localDx);
  const height = hy === 0 ? element.height : Math.max(MIN_SIZE, element.height + hy * localDy);
  const shiftX = (hx * (width - element.width)) / 2;
  const shiftY = (hy * (height - element.height)) / 2;
  const centerX = element.x + element.width / 2 + shiftX * cos - shiftY * sin;
  const centerY = element.y + element.height / 2 + shiftX * sin + shiftY * cos;

  return {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

// Ángulo (en grados, de -180 a 180) que deja el tirador de giro, que está encima del elemento, apuntando al puntero.
export function rotationTowards(element, pointX, pointY, step = 0) {
  const { x, y } = center(element);
  let degrees = (Math.atan2(pointY - y, pointX - x) * 180) / Math.PI + 90;
  if (degrees > 180) degrees -= 360;
  if (step > 0) degrees = Math.round(degrees / step) * step;
  return Math.round(degrees * 10) / 10;
}

function nearest(moving, lines, threshold) {
  let best = null;
  for (const position of moving) {
    for (const line of lines) {
      const delta = line - position;
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
    }
  }
  return best;
}

// Imán al mover: acerca los bordes y el centro de `box` a los bordes y centros del lienzo y de `others`
// (rectángulos de `bounds`) si quedan a menos de `threshold`. Devuelve el ajuste y las guías que se dibujan.
export function snapMove(box, others, canvas, threshold) {
  const verticals = [0, canvas.width / 2, canvas.width];
  const horizontals = [0, canvas.height / 2, canvas.height];
  for (const other of others) {
    verticals.push(other.left, (other.left + other.right) / 2, other.right);
    horizontals.push(other.top, (other.top + other.bottom) / 2, other.bottom);
  }

  const snapX = nearest([box.left, (box.left + box.right) / 2, box.right], verticals, threshold);
  const snapY = nearest([box.top, (box.top + box.bottom) / 2, box.bottom], horizontals, threshold);
  const guides = [];
  if (snapX) guides.push({ axis: 'x', position: snapX.line });
  if (snapY) guides.push({ axis: 'y', position: snapY.line });
  return { dx: snapX?.delta ?? 0, dy: snapY?.delta ?? 0, guides };
}

// Pila de estados (texto JSON) para deshacer y rehacer. Un estado igual al actual no se anota.
export function createHistory(initial, limit = HISTORY_LIMIT) {
  let states = [initial];
  let index = 0;

  return {
    get current() {
      return states[index];
    },
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < states.length - 1;
    },
    push(state) {
      if (state === states[index]) return false;

      states = [...states.slice(Math.max(0, index + 1 - (limit - 1)), index + 1), state];
      index = states.length - 1;
      return true;
    },
    undo() {
      if (index > 0) index -= 1;
      return states[index];
    },
    redo() {
      if (index < states.length - 1) index += 1;
      return states[index];
    },
    reset(state) {
      states = [state];
      index = 0;
    },
  };
}
