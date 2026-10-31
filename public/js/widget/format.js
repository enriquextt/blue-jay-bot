import { TEXT_VARIABLES } from './catalog.js';

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const rest = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

// Valores de las variables de las plantillas. `requester` llega ya traducido («pedida por X») o vacío.
export function templateValues({ title, artist = null, requester = null, position, duration }) {
  const hasDuration = duration > 0;
  return {
    title,
    artist: artist ?? '',
    requester: requester ?? '',
    meta: [artist, requester].filter(Boolean).join(' · '),
    position: formatTime(position),
    duration: hasDuration ? formatTime(duration) : '',
    remaining: hasDuration ? `-${formatTime(duration - position)}` : '',
  };
}

// Sustituye `{variable}` por su valor. Una variable desconocida se deja tal cual y una sin valor queda vacía.
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (TEXT_VARIABLES.includes(name) ? (values[name] ?? '') : match));
}
