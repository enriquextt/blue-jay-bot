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
  maxLines: [1, 10],
  templateLength: 200,
};

export const ELEMENT_TYPES = ['text', 'progress', 'disc', 'box'];

// Variables de las plantillas de texto. `requester` y `meta` salen ya traducidos con el idioma del widget.
export const TEXT_VARIABLES = ['title', 'artist', 'requester', 'meta', 'position', 'duration', 'remaining'];

export const FONT_WEIGHTS = [400, 500, 600, 700, 800];
export const ALIGNMENTS = ['left', 'center', 'right'];
export const VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'];
export const SHAPES = ['rect'];
export const FILLS = ['solid'];

// Valores de lo que falta en un elemento, por tipo. Lo común a todos está en `COMMON_DEFAULTS`.
export const COMMON_DEFAULTS = { visible: true, locked: false, rotation: 0, opacity: 1 };

export const TYPE_DEFAULTS = {
  text: { template: '{title}', color: '#ffffff', fontSize: 16, fontWeight: 400, align: 'left', valign: 'top', maxLines: 1 },
  progress: { color: '#4f8cff', track: '#ffffff2e', radius: 3 },
  disc: { accent: '#4f8cff' },
  box: { shape: { type: 'rect', radius: 0 }, fill: { type: 'solid', color: '#12151cd1' } },
};
