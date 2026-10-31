import {
  ALIGNMENTS,
  ASSET_ID,
  BORDER_STYLES,
  COMMON_DEFAULTS,
  ELEMENT_TYPES,
  FILL_TYPES,
  FONT_WEIGHTS,
  IMAGE_FITS,
  LIMITS,
  SHAPES,
  SURFACE_TYPES,
  TYPE_DEFAULTS,
  VERTICAL_ALIGNMENTS,
} from '../../public/js/widget/catalog.js';

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ELEMENT_ID = /^[\w-]{1,32}$/;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const inRange = (value, [min, max]) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isInRangeInt = (value, range) => Number.isInteger(value) && inRange(value, range);
const isColor = (value) => typeof value === 'string' && COLOR.test(value);

// Un campo ausente toma su valor por defecto; uno presente pero no válido invalida todo el layout (devuelve undefined).
function field(source, key, defaults, isValid) {
  if (!(key in source)) return defaults?.[key];
  return isValid(source[key]) ? source[key] : undefined;
}

// Las partes de una superficie (forma, relleno, borde y sombra) se reconstruyen campo a campo: devuelven un objeto
// nuevo con solo lo que corresponde, o null si algo no es válido.
function normalizeShape(input) {
  if (!isObject(input) || typeof input.type !== 'string' || !Object.hasOwn(SHAPES, input.type)) return null;

  const radius = input.radius ?? 0;
  if (!inRange(radius, LIMITS.radius)) return null;

  const { variants } = SHAPES[input.type];
  const variant = input.variant ?? null;
  if (variants.length === 0) return { type: input.type, radius, variant: null };
  if (variant !== null && !variants.includes(variant)) return null;
  return { type: input.type, radius, variant: variant ?? variants[0] };
}

function normalizeStops(stops) {
  if (!Array.isArray(stops) || !isInRangeInt(stops.length, LIMITS.gradientStops)) return null;

  const result = [];
  for (const stop of stops) {
    if (!isObject(stop) || !inRange(stop.offset, [0, 1]) || !isColor(stop.color)) return null;
    if (result.length > 0 && stop.offset < result.at(-1).offset) return null;
    result.push({ offset: stop.offset, color: stop.color });
  }
  return result;
}

function normalizeFill(input, { hasAsset }) {
  if (!isObject(input) || !FILL_TYPES.includes(input.type)) return null;

  switch (input.type) {
    case 'none':
      return { type: 'none' };
    case 'solid':
      return isColor(input.color) ? { type: 'solid', color: input.color } : null;
    case 'linear': {
      const angle = input.angle ?? 90;
      const stops = normalizeStops(input.stops);
      return inRange(angle, [0, 360]) && stops ? { type: 'linear', angle, stops } : null;
    }
    case 'radial': {
      const stops = normalizeStops(input.stops);
      return stops ? { type: 'radial', stops } : null;
    }
    default: {
      const asset = input.asset ?? null;
      const fit = input.fit ?? 'cover';
      if (!IMAGE_FITS.includes(fit)) return null;
      if (asset !== null && (typeof asset !== 'string' || !ASSET_ID.test(asset) || (hasAsset && !hasAsset(asset)))) return null;
      return { type: 'image', asset, fit };
    }
  }
}

function normalizeBorder(input, defaults) {
  const border = { ...defaults, ...(isObject(input) ? input : null) };
  if (input !== undefined && !isObject(input)) return null;
  if (!inRange(border.width, LIMITS.borderWidth) || !isColor(border.color) || !BORDER_STYLES.includes(border.style)) return null;
  return { width: border.width, color: border.color, style: border.style };
}

function normalizeShadow(input, defaults) {
  const shadow = { ...defaults, ...(isObject(input) ? input : null) };
  if (input !== undefined && !isObject(input)) return null;
  const valid = typeof shadow.enabled === 'boolean'
    && inRange(shadow.x, LIMITS.shadowOffset)
    && inRange(shadow.y, LIMITS.shadowOffset)
    && inRange(shadow.blur, LIMITS.shadowBlur)
    && isColor(shadow.color);
  return valid ? { enabled: shadow.enabled, x: shadow.x, y: shadow.y, blur: shadow.blur, color: shadow.color } : null;
}

function normalizeSurface(input, element, options) {
  const defaults = TYPE_DEFAULTS[element.type];
  const shape = normalizeShape(input.shape ?? defaults.shape);
  const fill = normalizeFill(input.fill ?? defaults.fill, options);
  const border = normalizeBorder(input.border, defaults.border);
  const shadow = normalizeShadow(input.shadow, defaults.shadow);
  return shape && fill && border && shadow ? { ...element, shape, fill, border, shadow } : null;
}

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
  box: {},
  image: {},
};

// El layout se guarda y se envía a los widgets, que lo dibujan: se reconstruye campo a campo a partir de lo
// conocido (lo demás se descarta) y nunca se admite CSS ni HTML libre, solo valores del catálogo.
function normalizeElement(input, options) {
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

  return SURFACE_TYPES.includes(element.type) ? normalizeSurface(input, element, options) : element;
}

// Convierte lo recibido en un layout limpio (sin `id`: lo pone quien lo guarda), o null si algo no es válido.
// `hasAsset(id)`, si se da, comprueba que las imágenes elegidas existen (al guardar; al cargar no hace falta).
export function normalizeLayout(input, { hasAsset = null } = {}) {
  if (!isObject(input)) return null;

  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length === 0 || name.length > LIMITS.nameLength) return null;

  const canvas = input.canvas;
  if (!isObject(canvas) || !isInRangeInt(canvas.width, LIMITS.canvasWidth) || !isInRangeInt(canvas.height, LIMITS.canvasHeight)) return null;

  const showSeconds = input.showSeconds ?? 10;
  const idleOpacity = input.idleOpacity ?? 0;
  if (!inRange(showSeconds, LIMITS.showSeconds) || !inRange(idleOpacity, [0, 1])) return null;

  if (!Array.isArray(input.elements) || input.elements.length > LIMITS.elements) return null;
  const elements = input.elements.map((element) => normalizeElement(element, { hasAsset }));
  if (elements.includes(null) || new Set(elements.map((element) => element.id)).size !== elements.length) return null;

  return { name, canvas: { width: canvas.width, height: canvas.height }, showSeconds, idleOpacity, elements };
}

// Los ids de las imágenes que usa un layout.
export function usedAssets(layout) {
  return layout.elements.flatMap((element) => (element.fill?.type === 'image' && element.fill.asset ? [element.fill.asset] : []));
}
