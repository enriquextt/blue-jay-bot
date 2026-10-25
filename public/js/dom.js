import { t } from './i18n.js';
import { icon } from './icons.js';

const CONFIRM_MS = 3000;

// Las pistas locales muestran "artista - título"; las de YouTube, solo el título.
export function trackLabel(track) {
  return track.artist ? `${track.artist} - ${track.title}` : track.title;
}

// Botón con icono y texto accesible (título y aria-label).
export function iconButton({ name, label, className = '', onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon ${className}`.trim();
  button.replaceChildren(icon(name));
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

export function textButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function titleSpan(title) {
  const span = document.createElement('span');
  span.className = 'track-title';
  span.textContent = title;
  span.title = title;
  return span;
}

// Acción destructiva con doble pulsación en lugar de confirm() nativo: la primera pulsación cambia el texto
// de `labelElement` a la clave `confirmKey` durante unos segundos y la segunda ejecuta `onConfirm`.
export function confirmOnSecondClick(button, labelElement, { labelKey, confirmKey, onConfirm }) {
  let timer = null;

  button.addEventListener('click', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      labelElement.textContent = t(labelKey);
      onConfirm();
      return;
    }

    labelElement.textContent = t(confirmKey);
    timer = setTimeout(() => {
      timer = null;
      labelElement.textContent = t(labelKey);
    }, CONFIRM_MS);
  });
}
