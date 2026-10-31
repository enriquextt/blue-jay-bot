// Geometría de las formas: el camino SVG de cada una para un elemento de `width` × `height`, en píxeles del
// elemento. Con ese camino se dibuja el relleno y el borde y se recorta la imagen, así que todos siguen la misma silueta.

const SLANT = 0.25;

// El + 0 evita el cero negativo (-0), que saldría como «-0» en el camino SVG.
const round = (value) => Math.round(value * 100) / 100 + 0;

function polygon(points) {
  return `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
}

function roundedRect(width, height, radius) {
  const r = Math.min(Math.max(radius, 0), width / 2, height / 2);
  if (r === 0) return polygon([[0, 0], [width, 0], [width, height], [0, height]]);

  const arc = (x, y) => `A${round(r)} ${round(r)} 0 0 1 ${round(x)} ${round(y)}`;
  return [
    `M${round(r)} 0`,
    `H${round(width - r)}`, arc(width, r),
    `V${round(height - r)}`, arc(width - r, height),
    `H${round(r)}`, arc(0, height - r),
    `V${round(r)}`, arc(r, 0),
    'Z',
  ].join('');
}

function ellipse(width, height) {
  const rx = round(width / 2);
  const ry = round(height / 2);
  return `M0 ${ry}A${rx} ${ry} 0 1 0 ${round(width)} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`;
}

// Media elipse que ocupa toda la caja; `variant` es el lado hacia el que se curva.
function semicircle(width, height, variant) {
  const rx = round(width / 2);
  const ry = round(height / 2);
  return {
    top: `M0 ${round(height)}A${rx} ${round(height)} 0 0 1 ${round(width)} ${round(height)}Z`,
    bottom: `M0 0A${rx} ${round(height)} 0 0 0 ${round(width)} 0Z`,
    left: `M${round(width)} 0A${round(width)} ${ry} 0 0 0 ${round(width)} ${round(height)}Z`,
    right: `M0 0A${round(width)} ${ry} 0 0 1 0 ${round(height)}Z`,
  }[variant];
}

// Triángulo rectángulo con el ángulo recto en la esquina indicada.
function cornerTriangle(width, height, variant) {
  return polygon({
    tl: [[0, 0], [width, 0], [0, height]],
    tr: [[0, 0], [width, 0], [width, height]],
    bl: [[0, 0], [0, height], [width, height]],
    br: [[width, 0], [width, height], [0, height]],
  }[variant]);
}

// Triángulo isósceles con la punta hacia el lado indicado.
function triangle(width, height, variant) {
  return polygon({
    top: [[width / 2, 0], [width, height], [0, height]],
    bottom: [[0, 0], [width, 0], [width / 2, height]],
    left: [[0, height / 2], [width, 0], [width, height]],
    right: [[0, 0], [width, height / 2], [0, height]],
  }[variant]);
}

function parallelogram(width, height, variant) {
  const slant = width * SLANT;
  return polygon(variant === 'left'
    ? [[0, 0], [width - slant, 0], [width, height], [slant, height]]
    : [[slant, 0], [width, 0], [width - slant, height], [0, height]]);
}

function hexagon(width, height) {
  const slant = width * SLANT;
  return polygon([[slant, 0], [width - slant, 0], [width, height / 2], [width - slant, height], [slant, height], [0, height / 2]]);
}

// `shape` es `{ type, radius, variant }`, ya validado.
export function shapePath({ type, radius = 0, variant = null }, width, height) {
  switch (type) {
    case 'ellipse':
      return ellipse(width, height);
    case 'semicircle':
      return semicircle(width, height, variant ?? 'top');
    case 'triangle-corner':
      return cornerTriangle(width, height, variant ?? 'tl');
    case 'triangle':
      return triangle(width, height, variant ?? 'top');
    case 'diamond':
      return polygon([[width / 2, 0], [width, height / 2], [width / 2, height], [0, height / 2]]);
    case 'parallelogram':
      return parallelogram(width, height, variant ?? 'right');
    case 'hexagon':
      return hexagon(width, height);
    default:
      return roundedRect(width, height, radius);
  }
}

// Extremos de un degradado lineal con el ángulo de CSS (0° hacia arriba, 90° hacia la derecha): una recta
// por el centro cuyo largo hace que las esquinas queden justo en los colores de los extremos.
export function linearGradientPoints(angle, width, height) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { x1: round(cx - dx * half), y1: round(cy - dy * half), x2: round(cx + dx * half), y2: round(cy + dy * half) };
}
