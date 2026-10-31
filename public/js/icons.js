const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 18;

// Iconos de trazo sobre una cuadrícula de 24x24. Cada forma es [tipo, ...datos].
const SHAPES = {
  star: [['path', 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z']],
  ban: [['circle', 12, 12, 9], ['path', 'M5.6 5.6l12.8 12.8']],
  plus: [['path', 'M12 5v14M5 12h14']],
  listAdd: [['path', 'M4 7h11M4 12h7M4 17h7M17 13v6M14 16h6']],
  play: [['path', 'M7 4.5l12 7.5-12 7.5z']],
  pause: [['path', 'M8 5v14M16 5v14']],
  stop: [['path', 'M7 7h10v10H7z']],
  skipNext: [['path', 'M6 5l9 7-9 7zM18 5v14']],
  shuffle: [['path', 'M16 4h4v4M4 20L20 4M20 16v4h-4M15 15l5 5M4 4l5 5']],
  trash: [['path', 'M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3']],
  bookmark: [['path', 'M6 4h12v16l-6-4-6 4z']],
  refresh: [['path', 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5']],
  eye: [['path', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'], ['circle', 12, 12, 3]],
  eyeOff: [['path', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'], ['circle', 12, 12, 3], ['path', 'M4 4l16 16']],
  lock: [['path', 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3']],
  unlock: [['path', 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-1.5']],
  copy: [['path', 'M9 9h11v11H9zM5 15V5h10']],
  undo: [['path', 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3']],
  redo: [['path', 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3']],
};

function shape([type, ...data]) {
  const element = document.createElementNS(SVG_NS, type);
  if (type === 'circle') {
    const [cx, cy, r] = data;
    element.setAttribute('cx', cx);
    element.setAttribute('cy', cy);
    element.setAttribute('r', r);
  } else {
    element.setAttribute('d', data[0]);
  }
  return element;
}

// Devuelve un <svg> decorativo que hereda el color del texto. Con `filled` se rellena (estrella activa).
export function icon(name, { filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', SIZE);
  svg.setAttribute('height', SIZE);
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', 2);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.append(...SHAPES[name].map(shape));
  return svg;
}
