import { applyAnimationTemplate } from './animation-templates.js';

// Layouts de serie (solo lectura: se duplican para editarlos). El Clásico reproduce el widget de la fase 6; los demás
// enseñan las formas, los rellenos y las animaciones. Sus nombres salen de `widget.templates.<id>` en los idiomas.
export const CLASSIC_ID = 'classic';

const text = (id, x, y, width, height, props = {}) => ({ id, type: 'text', x, y, width, height, ...props });
const subtle = { color: '#c4cbd8' };
const progress = (x, y, width) => ({ id: 'progress', type: 'progress', x, y, width, height: 6 });
const disc = (x, y, size) => ({ id: 'disc', type: 'disc', x, y, width: size, height: size });
const panel = (id, width, height, radius, color = '#12151cd1') => ({
  id, type: 'box', x: 0, y: 0, width, height, shape: { type: 'rect', radius }, fill: { type: 'solid', color },
});
const gradient = (angle, ...colors) => ({
  type: 'linear',
  angle,
  stops: colors.map((color, index) => ({ offset: index / (colors.length - 1), color })),
});

const CLASSIC = {
  id: CLASSIC_ID,
  name: 'Clásico',
  canvas: { width: 600, height: 140 },
  showSeconds: 10,
  idleOpacity: 0,
  elements: [
    panel('background', 600, 140, 12),
    disc(18, 38, 64),
    text('title', 98, 12, 484, 52, { template: '{title}', fontSize: 20, fontWeight: 700, maxLines: 2, valign: 'bottom' }),
    text('meta', 98, 66, 484, 20, { template: '{meta}', fontSize: 14, ...subtle }),
    progress(98, 94, 484),
    text('position', 98, 106, 240, 16, { template: '{position}', fontSize: 12, ...subtle }),
    text('duration', 342, 106, 240, 16, { template: '{duration}', fontSize: 12, align: 'right', ...subtle }),
  ],
};

const COMPACT = {
  id: 'compact',
  name: 'Compacto',
  canvas: { width: 420, height: 92 },
  showSeconds: 10,
  idleOpacity: 0,
  elements: applyAnimationTemplate([
    panel('background', 420, 92, 10),
    disc(12, 18, 56),
    text('title', 82, 12, 326, 22, { template: '{title}', fontSize: 17, fontWeight: 700, overflow: 'marquee' }),
    text('meta', 82, 36, 326, 16, { template: '{meta}', fontSize: 12, ...subtle }),
    progress(82, 62, 326),
    text('position', 82, 72, 160, 14, { template: '{position}', fontSize: 11, ...subtle }),
    text('duration', 248, 72, 160, 14, { template: '{duration}', fontSize: 11, align: 'right', ...subtle }),
  ], 'fade'),
};

const BAR = {
  id: 'bar',
  name: 'Solo barra',
  canvas: { width: 520, height: 44 },
  showSeconds: 10,
  idleOpacity: 0,
  elements: applyAnimationTemplate([
    panel('background', 520, 44, 22),
    text('title', 20, 4, 360, 28, { template: '{title}', fontSize: 15, fontWeight: 600, valign: 'middle', overflow: 'marquee' }),
    text('time', 392, 4, 110, 28, { template: '{position} / {duration}', fontSize: 12, align: 'right', valign: 'middle', ...subtle }),
    { id: 'progress', type: 'progress', x: 20, y: 33, width: 480, height: 4, radius: 2 },
  ], 'reveal'),
};

const BIG_DISC = {
  id: 'big-disc',
  name: 'Disco grande',
  canvas: { width: 560, height: 210 },
  showSeconds: 10,
  idleOpacity: 0,
  elements: applyAnimationTemplate([
    { ...panel('background', 560, 210, 28), fill: gradient(135, '#1b2030f0', '#0d0f14f0') },
    disc(22, 25, 160),
    text('title', 206, 28, 332, 78, { template: '{title}', fontSize: 26, fontWeight: 700, maxLines: 2, valign: 'bottom', fontFamily: 'montserrat' }),
    text('meta', 206, 112, 332, 22, { template: '{meta}', fontSize: 15, ...subtle }),
    progress(206, 146, 332),
    text('position', 206, 160, 160, 18, { template: '{position}', fontSize: 13, ...subtle }),
    text('duration', 378, 160, 160, 18, { template: '{duration}', fontSize: 13, align: 'right', ...subtle }),
  ], 'zoom-soft'),
};

const CORNER_BANNER = {
  id: 'corner-banner',
  name: 'Banner con triángulo en la esquina',
  canvas: { width: 600, height: 140 },
  showSeconds: 10,
  idleOpacity: 0,
  elements: applyAnimationTemplate([
    panel('background', 600, 140, 12),
    {
      id: 'corner', type: 'box', x: 0, y: 0, width: 128, height: 128,
      shape: { type: 'triangle-corner', variant: 'tl' }, fill: gradient(135, '#4f8cff', '#8a4fff'),
    },
    disc(10, 10, 52),
    text('title', 140, 16, 440, 58, { template: '{title}', fontSize: 24, fontWeight: 800, maxLines: 2, valign: 'bottom', fontFamily: 'oswald' }),
    text('meta', 140, 78, 440, 20, { template: '{meta}', fontSize: 14, ...subtle }),
    progress(140, 106, 440),
    text('position', 140, 116, 220, 16, { template: '{position}', fontSize: 12, ...subtle }),
    text('duration', 360, 116, 220, 16, { template: '{duration}', fontSize: 12, align: 'right', ...subtle }),
  ], 'slide-stagger'),
};

const SEMICIRCLE = {
  id: 'semicircle',
  name: 'Semicírculo',
  canvas: { width: 420, height: 210 },
  showSeconds: 10,
  idleOpacity: 0,
  elements: applyAnimationTemplate([
    {
      id: 'background', type: 'box', x: 0, y: 0, width: 420, height: 210,
      shape: { type: 'semicircle', variant: 'top' }, fill: gradient(180, '#4f8cffe6', '#12151cf2'),
      border: { width: 3, color: '#ffffff40', style: 'solid' },
    },
    disc(178, 26, 64),
    text('title', 70, 98, 280, 34, { template: '{title}', fontSize: 22, fontWeight: 700, align: 'center', overflow: 'marquee' }),
    text('meta', 70, 134, 280, 18, { template: '{meta}', fontSize: 13, align: 'center', color: '#e1e6f0' }),
    progress(100, 164, 220),
    text('time', 100, 174, 220, 16, { template: '{position} / {duration}', fontSize: 12, align: 'center', color: '#e1e6f0' }),
  ], 'pop'),
};

export const TEMPLATES = [CLASSIC, COMPACT, BAR, BIG_DISC, CORNER_BANNER, SEMICIRCLE];
