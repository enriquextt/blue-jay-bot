import { fillTemplate } from './format.js';
import { assetFamily, fontStack, isAssetFont } from './fonts.js';

const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
// Velocidad del rótulo y puntos con los que se dibuja el contorno (alrededor de cada letra, a la distancia del grosor).
const MARQUEE_PIXELS_PER_SECOND = 40;
const MARQUEE_PAUSE_SECONDS = 3;
const OUTLINE_POINTS = 16;

// Las fuentes subidas se registran la primera vez que las usa un texto; devuelve cuándo están listas (o fallaron:
// entonces se queda la de reserva).
const customFonts = new Map();

function loadCustomFont(id) {
  if (!customFonts.has(id)) {
    const load = typeof FontFace === 'undefined'
      ? Promise.resolve()
      : new FontFace(assetFamily(id), `url(/widget-assets/${id})`).load().then((face) => { document.fonts.add(face); }).catch(() => {});
    customFonts.set(id, load);
  }
  return customFonts.get(id);
}

const cssGradient = ({ angle, stops }) => `linear-gradient(${angle}deg, ${stops.map(({ offset, color }) => `${color} ${offset * 100}%`).join(', ')})`;

// El contorno se hace con sombras alrededor de la letra, no con `-webkit-text-stroke`: así se ve igual en cualquier
// versión del navegador de OBS y no se come el relleno.
function outlineShadows({ width, color }) {
  return Array.from({ length: OUTLINE_POINTS }, (_, index) => {
    const angle = (index / OUTLINE_POINTS) * 2 * Math.PI;
    return `${(Math.cos(angle) * width).toFixed(2)}px ${(Math.sin(angle) * width).toFixed(2)}px 0 ${color}`;
  });
}

// Con un degradado el relleno es transparente (el degradado es el fondo recortado a las letras) y una sombra de texto
// se vería a través de él: ahí el contorno y la sombra se dibujan con `drop-shadow`, que sigue lo ya pintado.
function dropShadows({ outline, shadow }) {
  const layers = [];
  if (outline.width > 0) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) layers.push(`drop-shadow(${dx * outline.width}px ${dy * outline.width}px 0 ${outline.color})`);
  }
  if (shadow.enabled) layers.push(`drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})`);
  return layers.join(' ');
}

function textShadow({ outline, shadow }) {
  const layers = [];
  if (shadow.enabled) layers.push(`${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`);
  if (outline.width > 0) layers.push(...outlineShadows(outline));
  return layers.join(', ');
}

// Un elemento de texto: la plantilla con las variables sustituidas, con la fuente y el estilo del layout.
// Devuelve el nodo, cómo actualizarlo y cómo volver a medirlo (el rótulo depende de lo que ocupe el texto).
export function buildText(element) {
  const node = document.createElement('div');
  node.style.justifyContent = JUSTIFY[element.valign];

  // El texto siempre entra por `textContent`: una plantilla nunca se interpreta como HTML.
  const body = document.createElement('div');
  body.className = `text-body${element.overflow === 'marquee' ? ' marquee' : ''}`;
  Object.assign(body.style, {
    color: element.color,
    fontFamily: fontStack(element.fontFamily),
    fontSize: `${element.fontSize}px`,
    fontWeight: element.fontWeight,
    fontStyle: element.italic ? 'italic' : 'normal',
    lineHeight: element.lineHeight,
    letterSpacing: `${element.letterSpacing}px`,
    textTransform: element.uppercase ? 'uppercase' : 'none',
    textAlign: element.align,
    textShadow: element.gradient ? 'none' : textShadow(element),
    webkitLineClamp: element.maxLines,
    lineClamp: element.maxLines,
  });
  if (element.gradient) {
    Object.assign(body.style, {
      background: cssGradient(element.gradient),
      backgroundClip: 'text',
      webkitBackgroundClip: 'text',
      color: 'transparent',
      filter: dropShadows(element),
    });
  }

  // El rótulo mueve un texto de una sola línea dentro de la caja, que recorta lo que sobra.
  const content = element.overflow === 'marquee' ? document.createElement('span') : body;
  if (content !== body) {
    content.className = 'marquee-text';
    body.append(content);
  }
  node.append(body);

  function measure() {
    if (content === body) return;

    const distance = Math.ceil(content.scrollWidth - body.clientWidth);
    const running = distance > 1;
    content.classList.toggle('running', running);
    if (running) {
      content.style.setProperty('--marquee-distance', `-${distance}px`);
      content.style.setProperty('--marquee-duration', `${(distance / MARQUEE_PIXELS_PER_SECOND + MARQUEE_PAUSE_SECONDS).toFixed(1)}s`);
    }
  }

  if (isAssetFont(element.fontFamily)) loadCustomFont(element.fontFamily).then(measure);

  return {
    node,
    measure,
    update({ values }) {
      const text = fillTemplate(element.template, values);
      if (content.textContent === text) return;

      content.textContent = text;
      measure();
    },
  };
}
