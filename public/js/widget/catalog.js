// Catálogo del widget: datos sin DOM que importan el widget, el editor y el servidor (para validar),
// de modo que lo que se puede elegir y lo que se acepta no se desincronizan.

export const LIMITS = {
  nameLength: 60,
  layouts: 30,
  elements: 40,
  canvasWidth: [100, 2000],
  canvasHeight: [40, 1200],
  showSeconds: [1, 120],
  position: [-5000, 5000],
  size: [1, 5000],
  fontSize: [6, 400],
  radius: [0, 500],
  borderWidth: [0, 50],
  shadowOffset: [-200, 200],
  shadowBlur: [0, 100],
  gradientStops: [2, 4],
  maxLines: [1, 10],
  lineHeight: [0.8, 3],
  letterSpacing: [-5, 50],
  outlineWidth: [0, 20],
  animationDuration: [50, 5000],
  animationDelay: [0, 5000],
  loopDuration: [500, 20000],
  templateLength: 200,
};

export const ELEMENT_TYPES = ['text', 'progress', 'disc', 'box', 'image'];

// Elementos con superficie: forma, relleno, borde y sombra.
export const SURFACE_TYPES = ['box', 'image'];

// Variables de las plantillas de texto. `requester` y `meta` salen ya traducidos con el idioma del widget.
export const TEXT_VARIABLES = ['title', 'artist', 'requester', 'meta', 'position', 'duration', 'remaining'];

export const FONT_WEIGHTS = [400, 500, 600, 700, 800];
export const ALIGNMENTS = ['left', 'center', 'right'];
export const VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'];

// Qué hace un texto que no cabe: recortar con «…» (hasta `maxLines` líneas) o desplazarse como un rótulo.
export const OVERFLOWS = ['clamp', 'marquee'];

// Formas y sus variantes (hacia dónde apunta o en qué esquina está). La geometría está en `shapes.js`.
export const SHAPES = {
  rect: { variants: [] },
  ellipse: { variants: [] },
  semicircle: { variants: ['top', 'bottom', 'left', 'right'] },
  'triangle-corner': { variants: ['tl', 'tr', 'bl', 'br'] },
  triangle: { variants: ['top', 'bottom', 'left', 'right'] },
  diamond: { variants: [] },
  parallelogram: { variants: ['right', 'left'] },
  hexagon: { variants: [] },
};
export const SHAPE_TYPES = Object.keys(SHAPES);

export const FILL_TYPES = ['none', 'solid', 'linear', 'radial', 'image'];
export const IMAGE_FITS = ['cover', 'contain', 'stretch'];
export const BORDER_STYLES = ['solid', 'dashed'];

// Formato de un id de activo (imagen subida): los 32 primeros caracteres hexadecimales de su SHA-256.
export const ASSET_ID = /^[0-9a-f]{32}$/;

// Valores de lo que falta en un elemento, por tipo. Lo común a todos está en `COMMON_DEFAULTS`.
export const COMMON_DEFAULTS = { visible: true, locked: false, rotation: 0, opacity: 1 };

function surfaceDefaults() {
  return {
    shape: { type: 'rect', radius: 0, variant: null },
    border: { width: 0, color: '#ffffff', style: 'solid' },
    shadow: { enabled: false, x: 0, y: 4, blur: 8, color: '#00000080' },
  };
}

export const TYPE_DEFAULTS = {
  text: {
    template: '{title}',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
    valign: 'top',
    maxLines: 1,
    fontFamily: 'system',
    italic: false,
    uppercase: false,
    lineHeight: 1.3,
    letterSpacing: 0,
    overflow: 'clamp',
    gradient: null,
    outline: { width: 0, color: '#000000' },
    shadow: { enabled: false, x: 0, y: 2, blur: 4, color: '#000000b3' },
  },
  progress: { color: '#4f8cff', track: '#ffffff2e', radius: 3 },
  disc: { accent: '#4f8cff' },
  box: { ...surfaceDefaults(), fill: { type: 'solid', color: '#12151cd1' } },
  image: { ...surfaceDefaults(), fill: { type: 'image', asset: null, fit: 'cover' } },
};

// Degradado de un texto al activarlo en el editor.
export const DEFAULT_TEXT_GRADIENT = { angle: 90, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#4f8cff' }] };

// Relleno al cambiar de tipo en el editor.
export const DEFAULT_FILLS = {
  none: { type: 'none' },
  solid: { type: 'solid', color: '#4f8cff' },
  linear: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#4f8cff' }, { offset: 1, color: '#8a4fff' }] },
  radial: { type: 'radial', stops: [{ offset: 0, color: '#4f8cff' }, { offset: 1, color: '#12151c' }] },
  image: { type: 'image', asset: null, fit: 'cover' },
};

// Animaciones de un elemento: de entrada (`in`), de salida (`out`, la misma animación al revés) y en bucle (`loop`).
// Los nombres coinciden con los `@keyframes` de `widget-render.css`; en el layout solo se guarda el nombre, nunca CSS.
export const ENTER_PRESETS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-top', 'slide-bottom', 'zoom', 'pop', 'flip', 'reveal', 'blur', 'typewriter'];
export const LOOP_PRESETS = ['none', 'spin', 'pulse', 'float', 'shimmer'];
export const EASINGS = {
  'ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
  'ease-in-out': 'ease-in-out',
  linear: 'linear',
  bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

// Lo que falta de la animación de un elemento. El disco gira por defecto, como el de las versiones anteriores.
export function animationDefaults(type) {
  return {
    in: { preset: 'none', duration: 500, delay: 0, easing: 'ease-out' },
    out: { preset: 'none', duration: 500, delay: 0, easing: 'ease-out' },
    loop: { preset: type === 'disc' ? 'spin' : 'none', duration: 3000 },
  };
}
