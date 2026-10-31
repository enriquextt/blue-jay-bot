import {
  ALIGNMENTS,
  COMMON_DEFAULTS,
  ELEMENT_TYPES,
  FILLS,
  FONT_WEIGHTS,
  LIMITS,
  SHAPES,
  TYPE_DEFAULTS,
  VERTICAL_ALIGNMENTS,
} from '../../public/js/widget/catalog.js';

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ELEMENT_ID = /^[\w-]{1,32}$/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const inRange = (value, [min, max]) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isInRangeInt = (value, range) => Number.isInteger(value) && inRange(value, range);

// Un campo ausente toma su valor por defecto; uno presente pero no válido invalida todo el layout (devuelve undefined).
function field(source, key, defaults, isValid) {
  if (!(key in source)) return defaults?.[key];
  return isValid(source[key]) ? source[key] : undefined;
}

// El layout se guarda y se envía a los widgets, que lo dibujan: se reconstruye campo a campo a partir de lo
// conocido (lo demás se descarta) y nunca se admite CSS ni HTML libre, solo valores del catálogo.
function normalizeElement(input) {
  if (!isObject(input) || typeof input.id !== 'string' || !ELEMENT_ID.test(input.id) || !ELEMENT_TYPES.includes(input.type)) return null;

  const element = { id: input.id, type: input.type };
  const rules = {
    visible: [COMMON_DEFAULTS, (value) => typeof value === 'boolean'],
    locked: [COMMON_DEFAULTS, (value) => typeof value === 'boolean'],
    rotation: [COMMON_DEFAULTS, (value) => inRange(value, [-360, 360])],
    opacity: [COMMON_DEFAULTS, (value) => inRange(value, [0, 1])],
    x: [null, (value) => inRange(value, LIMITS.position)],
    y: [null, (value) => inRange(value, LIMITS.position)],
    width: [null, (value) => inRange(value, LIMITS.size)],
    height: [null, (value) => inRange(value, LIMITS.size)],
    ...TYPE_RULES[input.type],
  };

  for (const [key, [defaults, isValid]] of Object.entries(rules)) {
    const defaultSource = defaults ?? TYPE_DEFAULTS[input.type];
    const value = field(input, key, defaultSource, isValid);
    if (value === undefined) return null;
    element[key] = value;
  }

  // Los objetos anidados se reconstruyen para no arrastrar campos desconocidos.
  if (element.type === 'box') {
    element.shape = { type: element.shape.type, radius: element.shape.radius ?? 0 };
    element.fill = { type: element.fill.type, color: element.fill.color };
  }
  return element;
}

const isColor = (value) => typeof value === 'string' && COLOR.test(value);

const TYPE_RULES = {
  text: {
    template: [null, (value) => typeof value === 'string' && value.length <= LIMITS.templateLength && !/[\r\n]/.test(value)],
    color: [null, isColor],
    fontSize: [null, (value) => inRange(value, LIMITS.fontSize)],
    fontWeight: [null, (value) => FONT_WEIGHTS.includes(value)],
    align: [null, (value) => ALIGNMENTS.includes(value)],
    valign: [null, (value) => VERTICAL_ALIGNMENTS.includes(value)],
    maxLines: [null, (value) => isInRangeInt(value, LIMITS.maxLines)],
  },
  progress: {
    color: [null, isColor],
    track: [null, isColor],
    radius: [null, (value) => inRange(value, LIMITS.radius)],
  },
  disc: {
    accent: [null, isColor],
  },
  box: {
    shape: [null, (value) => isObject(value) && SHAPES.includes(value.type) && inRange(value.radius ?? 0, LIMITS.radius)],
    fill: [null, (value) => isObject(value) && FILLS.includes(value.type) && isColor(value.color)],
  },
};

// Convierte lo recibido en un layout limpio (sin `id`: lo pone quien lo guarda), o null si algo no es válido.
export function normalizeLayout(input) {
  if (!isObject(input)) return null;

  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length === 0 || name.length > LIMITS.nameLength) return null;

  const canvas = input.canvas;
  if (!isObject(canvas) || !isInRangeInt(canvas.width, LIMITS.canvasWidth) || !isInRangeInt(canvas.height, LIMITS.canvasHeight)) return null;

  const showSeconds = input.showSeconds ?? 10;
  const idleOpacity = input.idleOpacity ?? 0;
  if (!inRange(showSeconds, LIMITS.showSeconds) || !inRange(idleOpacity, [0, 1])) return null;

  if (!Array.isArray(input.elements) || input.elements.length > LIMITS.elements) return null;
  const elements = input.elements.map(normalizeElement);
  if (elements.includes(null) || new Set(elements.map((element) => element.id)).size !== elements.length) return null;

  return { name, canvas: { width: canvas.width, height: canvas.height }, showSeconds, idleOpacity, elements };
}
