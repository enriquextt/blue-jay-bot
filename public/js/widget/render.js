import { EASINGS } from './catalog.js';
import { buildSurface } from './surface.js';
import { buildText } from './text.js';

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
  box: (element) => ({ node: buildSurface(element) }),

  image: (element) => ({ node: buildSurface(element) }),

  text: buildText,

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

// Lo que tarda en terminar una animación de entrada o de salida de un elemento visible (la más larga de todas).
function transitionTime(layout, slot) {
  return Math.max(0, ...layout.elements
    .filter((element) => element.visible && element.animation[slot].preset !== 'none')
    .map((element) => element.animation[slot].delay + element.animation[slot].duration));
}

// Dibuja un layout dentro de `container`. Lo usan el widget de OBS y el lienzo del editor.
// El lienzo tiene el tamaño del layout y se escala por igual para caber en el contenedor, anclado arriba a la izquierda.
//
// Ciclo de vida (si algún elemento tiene animación de entrada o de salida): `idle` (en reposo, a la opacidad en reposo),
// `entering`, `visible` y `exiting`, que se vuelve a `idle`. Con `preview` (el editor) el lienzo siempre está en
// `visible` y solo cambia de fase con `cycle()`.
export function createRenderer(container, { idleOpacity = null, preview = false } = {}) {
  const stage = document.createElement('div');
  stage.className = 'stage empty';
  container.append(stage);

  let layout = null;
  let updaters = [];
  let measurers = [];
  let enterMs = 0;
  let exitMs = 0;
  let phase = 'idle';
  let wasShown = false;
  const timers = new Set();

  // Cuando termina de cargarse una fuente cambia lo que ocupa el texto: los rótulos se miden otra vez.
  document.fonts?.addEventListener('loadingdone', () => measurers.forEach((measure) => measure()));

  function later(ms, action) {
    const id = setTimeout(() => {
      timers.delete(id);
      action();
    }, ms);
    timers.add(id);
  }

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  // Con animaciones el lienzo se ve mientras dura el ciclo (de `entering` a `exiting`) y vuelve a la opacidad en reposo
  // justo al terminar la salida, no en el siguiente `update`: si no, los elementos reaparecerían un instante.
  function setPhase(next) {
    phase = next;
    stage.dataset.phase = next;
    if (!preview && stage.classList.contains('animated')) stage.classList.toggle('shown', next !== 'idle');
  }

  // Volver a `entering` desde `entering` o `visible` tiene que reiniciar las animaciones: se pasa por `idle` y se fuerza el repintado.
  function enter() {
    clearTimers();
    setPhase('idle');
    void stage.offsetWidth;
    setPhase('entering');
    later(enterMs, () => setPhase('visible'));
  }

  function exit() {
    clearTimers();
    setPhase('exiting');
    later(exitMs, () => setPhase(preview ? 'visible' : 'idle'));
  }

  function fit() {
    // Con el contenedor oculto (por ejemplo, en una pestaña cerrada) no hay tamaño con el que escalar.
    if (!layout || container.clientWidth === 0 || container.clientHeight === 0) return;
    const { width, height } = layout.canvas;
    const scale = Math.min(container.clientWidth / width, container.clientHeight / height);
    stage.style.transform = `scale(${scale})`;
  }

  function buildElement(element) {
    const { node: content, update, measure } = BUILDERS[element.type](element);
    content.classList.add('content', element.type);

    const loop = document.createElement('div');
    loop.className = 'loop';
    loop.append(content);
    const fx = document.createElement('div');
    fx.className = 'fx';
    fx.append(loop);

    const node = document.createElement('div');
    node.className = 'el';
    node.dataset.id = element.id;
    const { in: enterAnimation, out: exitAnimation, loop: loopAnimation } = element.animation;
    Object.assign(node.dataset, { in: enterAnimation.preset, out: exitAnimation.preset, loop: loopAnimation.preset });
    for (const [name, animation] of [['in', enterAnimation], ['out', exitAnimation]]) {
      node.style.setProperty(`--${name}-duration`, `${animation.duration}ms`);
      node.style.setProperty(`--${name}-delay`, `${animation.delay}ms`);
      node.style.setProperty(`--${name}-easing`, EASINGS[animation.easing]);
    }
    node.style.setProperty('--loop-duration', `${loopAnimation.duration}ms`);
    Object.assign(node.style, {
      left: `${element.x}px`,
      top: `${element.y}px`,
      width: `${element.width}px`,
      height: `${element.height}px`,
      opacity: element.opacity,
      transform: element.rotation ? `rotate(${element.rotation}deg)` : '',
      display: element.visible ? '' : 'none',
    });
    node.append(fx);
    return { node, update, measure };
  }

  return {
    stage,

    get layout() {
      return layout;
    },

    // Lo que tardan en acabar las animaciones de entrada y de salida del layout actual, en milisegundos.
    get timing() {
      return { enter: enterMs, exit: exitMs };
    },

    setLayout(next) {
      layout = next;
      updaters = [];
      measurers = [];
      stage.replaceChildren();
      stage.style.width = `${layout.canvas.width}px`;
      stage.style.height = `${layout.canvas.height}px`;
      stage.style.setProperty('--idle-opacity', idleOpacity ?? layout.idleOpacity);

      for (const element of layout.elements) {
        const { node, update, measure } = buildElement(element);
        stage.append(node);
        if (update) updaters.push(update);
        if (measure) measurers.push(measure);
      }

      enterMs = transitionTime(layout, 'in');
      exitMs = transitionTime(layout, 'out');
      stage.classList.toggle('animated', enterMs > 0 || exitMs > 0);
      // Un layout nuevo parte de su estado de reposo (o visible, en el editor); el siguiente `update` lo hace entrar si toca.
      clearTimers();
      setPhase(preview ? 'visible' : 'idle');
      wasShown = false;
      fit();
    },

    fit,

    // Reproduce la entrada, espera `holdMs` y reproduce la salida, para ver las animaciones en el editor (`preview`).
    cycle(holdMs = 1200) {
      enter();
      later(enterMs + holdMs, exit);
    },

    // `view` es null cuando no hay nada que mostrar; si no, `{ values, fraction }` (ver `templateValues`).
    // `shown`: visible del todo; si no, solo con la opacidad en reposo. `paused` detiene las animaciones en bucle.
    update(view, { shown = false, paused = false } = {}) {
      stage.classList.toggle('empty', !view);
      stage.classList.toggle('paused', paused);
      if (view) for (const update of updaters) update(view);

      if (preview) {
        stage.classList.add('shown');
        return;
      }
      if (!view) {
        clearTimers();
        setPhase('idle');
        stage.classList.remove('shown');
        wasShown = false;
        return;
      }

      if (stage.classList.contains('animated')) {
        if (shown && !wasShown) enter();
        else if (!shown && wasShown) exit();
        stage.classList.toggle('shown', phase !== 'idle');
      } else {
        stage.classList.toggle('shown', shown);
      }
      wasShown = shown;
    },
  };
}
