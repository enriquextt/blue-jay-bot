import { linearGradientPoints, shapePath } from './shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FIT = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', stretch: 'none' };

// Los ids de los degradados y recortes deben ser únicos en toda la página.
let counter = 0;

function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function stops(list) {
  return list.map(({ offset, color }) => {
    const stop = svg('stop', { offset });
    stop.style.stopColor = color;
    return stop;
  });
}

// Dibuja un elemento con superficie (caja o imagen): su forma con el relleno, el borde y la sombra. Todo sigue el
// mismo camino SVG, de modo que un círculo o un triángulo recortan la imagen y el degradado y llevan su borde.
export function buildSurface({ width, height, shape, fill, border, shadow }) {
  counter += 1;
  const clipId = `surface-clip-${counter}`;
  const fillId = `surface-fill-${counter}`;
  const path = shapePath(shape, width, height);

  const defs = svg('defs', {}, svg('clipPath', { id: clipId }, svg('path', { d: path })));
  const content = svg('g', { 'clip-path': `url(#${clipId})` });

  switch (fill.type) {
    case 'solid':
      content.append(svg('path', { d: path, fill: fill.color }));
      break;
    case 'linear':
      defs.append(svg('linearGradient', { id: fillId, gradientUnits: 'userSpaceOnUse', ...linearGradientPoints(fill.angle, width, height) }, ...stops(fill.stops)));
      content.append(svg('path', { d: path, fill: `url(#${fillId})` }));
      break;
    case 'radial':
      // Radio de media diagonal: las esquinas de la caja quedan en el último color.
      defs.append(svg('radialGradient', { id: fillId, cx: 0.5, cy: 0.5, r: 0.7071 }, ...stops(fill.stops)));
      content.append(svg('path', { d: path, fill: `url(#${fillId})` }));
      break;
    case 'image':
      // Sin imagen elegida todavía no se dibuja nada.
      if (fill.asset) {
        content.append(svg('image', { href: `/widget-assets/${fill.asset}`, x: 0, y: 0, width, height, preserveAspectRatio: FIT[fill.fit] }));
      }
      break;
  }

  const drawing = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}` }, defs, content);
  if (border.width > 0) {
    // El trazo se centra en el borde de la forma: doble de ancho y recortado a la forma, queda solo el de dentro.
    drawing.append(svg('path', {
      d: path,
      fill: 'none',
      stroke: border.color,
      'stroke-width': border.width * 2,
      'stroke-dasharray': border.style === 'dashed' ? `${border.width * 3} ${border.width * 2}` : 'none',
      'clip-path': `url(#${clipId})`,
    }));
  }
  drawing.style.display = 'block';

  const node = document.createElement('div');
  node.append(drawing);
  // `drop-shadow` sigue la silueta (`box-shadow` seguiría el rectángulo).
  if (shadow.enabled) node.style.filter = `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})`;
  return node;
}
