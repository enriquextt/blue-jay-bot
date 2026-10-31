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
  text: { template: '{title}', color: '#ffffff', fontSize: 16, fontWeight: 400, align: 'left', valign: 'top', maxLines: 1 },
  progress: { color: '#4f8cff', track: '#ffffff2e', radius: 3 },
  disc: { accent: '#4f8cff' },
  box: { ...surfaceDefaults(), fill: { type: 'solid', color: '#12151cd1' } },
  image: { ...surfaceDefaults(), fill: { type: 'image', asset: null, fit: 'cover' } },
};

// Relleno al cambiar de tipo en el editor.
export const DEFAULT_FILLS = {
  none: { type: 'none' },
  solid: { type: 'solid', color: '#4f8cff' },
  linear: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#4f8cff' }, { offset: 1, color: '#8a4fff' }] },
  radial: { type: 'radial', stops: [{ offset: 0, color: '#4f8cff' }, { offset: 1, color: '#12151c' }] },
  image: { type: 'image', asset: null, fit: 'cover' },
};
