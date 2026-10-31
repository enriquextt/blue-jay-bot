import { fillTemplate } from './format.js';

const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

// Disco de vinilo. Solo el centro cambia de color, así que el resto es marcado fijo.
const DISC_MARKUP = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="48" fill="#0d0f14" stroke="#2a2f3a" stroke-width="2"/>
  <circle cx="50" cy="50" r="40" fill="none" stroke="#1d212b" stroke-width="1.5"/>
  <circle cx="50" cy="50" r="33" fill="none" stroke="#1d212b" stroke-width="1.5"/>
  <circle cx="50" cy="50" r="26" fill="none" stroke="#1d212b" stroke-width="1.5"/>
  <path d="M50 8 A42 42 0 0 1 92 50" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3" stroke-linecap="round"/>
  <path d="M50 92 A42 42 0 0 1 8 50" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3" stroke-linecap="round"/>
  <circle class="accent" cx="50" cy="50" r="16"/>
  <circle cx="50" cy="40" r="4" fill="#fff" fill-opacity=".55"/>
  <circle cx="50" cy="50" r="3" fill="#0d0f14"/>
</svg>`;

// Cada constructor devuelve el nodo del elemento y, si lo necesita, cómo actualizarlo con los datos de la canción.
const BUILDERS = {
  box(element) {
    const node = document.createElement('div');
    node.style.background = element.fill.color;
    node.style.borderRadius = `${element.shape.radius}px`;
    return { node };
  },

  text(element) {
    const node = document.createElement('div');
    node.style.justifyContent = JUSTIFY[element.valign];

    // El texto siempre entra por `textContent`: una plantilla nunca se interpreta como HTML.
    const body = document.createElement('div');
    body.className = 'text-body';
    Object.assign(body.style, {
      color: element.color,
      fontSize: `${element.fontSize}px`,
      fontWeight: element.fontWeight,
      textAlign: element.align,
      webkitLineClamp: element.maxLines,
      lineClamp: element.maxLines,
    });
    node.append(body);

    return {
      node,
      update({ values }) {
        const text = fillTemplate(element.template, values);
        if (body.textContent !== text) body.textContent = text;
      },
    };
  },

  progress(element) {
    const node = document.createElement('div');
    node.style.background = element.track;
    node.style.borderRadius = `${element.radius}px`;

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.background = element.color;
    node.append(bar);

    return {
      node,
      update({ fraction }) {
        bar.style.width = `${fraction * 100}%`;
      },
    };
  },

  disc(element) {
    const node = document.createElement('div');
    node.innerHTML = DISC_MARKUP;
    node.querySelector('.accent').setAttribute('fill', element.accent);
    return { node };
  },
};

// Dibuja un layout dentro de `container`. Lo usan el widget de OBS y el lienzo del editor.
// El lienzo tiene el tamaño del layout y se escala por igual para caber en el contenedor, anclado arriba a la izquierda.
export function createRenderer(container, { idleOpacity = null } = {}) {
  const stage = document.createElement('div');
  stage.className = 'stage empty';
  container.append(stage);

  let layout = null;
  let updaters = [];

  function fit() {
    if (!layout) return;
    const { width, height } = layout.canvas;
    const scale = Math.min(container.clientWidth / width, container.clientHeight / height);
    stage.style.transform = `scale(${scale})`;
  }

  return {
    stage,

    get layout() {
      return layout;
    },

    setLayout(next) {
      layout = next;
      updaters = [];
      stage.replaceChildren();
      stage.style.width = `${layout.canvas.width}px`;
      stage.style.height = `${layout.canvas.height}px`;
      stage.style.setProperty('--idle-opacity', idleOpacity ?? layout.idleOpacity);

      for (const element of layout.elements) {
        const { node, update } = BUILDERS[element.type](element);
        node.className = `el ${element.type}`;
        node.dataset.id = element.id;
        Object.assign(node.style, {
          left: `${element.x}px`,
          top: `${element.y}px`,
          width: `${element.width}px`,
          height: `${element.height}px`,
          opacity: element.opacity,
          transform: element.rotation ? `rotate(${element.rotation}deg)` : '',
          display: element.visible ? '' : 'none',
        });
        stage.append(node);
        if (update) updaters.push(update);
      }
      fit();
    },

    fit,

    // `view` es null cuando no hay nada que mostrar; si no, `{ values, fraction }` (ver `templateValues`).
    // `shown`: visible del todo; si no, solo con la opacidad en reposo. `paused` detiene el giro del disco.
    update(view, { shown = false, paused = false } = {}) {
      stage.classList.toggle('empty', !view);
      stage.classList.toggle('shown', shown);
      stage.classList.toggle('paused', paused);
      if (view) for (const update of updaters) update(view);
    },
  };
}
