import { EventEmitter } from 'node:events';

export const MAX_LIMIT = 1000;
const LIMIT_SCOPES = ['user', 'global'];
const KEY = 'settings';

const DEFAULTS = {
  chatEnabled: true,
  localFallback: true,
  limits: {
    user: { enabled: true, max: 25 },
    global: { enabled: true, max: 100 },
  },
};

const isLimit = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT;

// Ajustes que se cambian desde el panel y se guardan en la base de datos:
// si el chat acepta peticiones, si un vídeo que no se puede reproducir se sustituye por su versión local
// y los límites de peticiones activas (por usuario y global).
export class Settings extends EventEmitter {
  #kv;
  #value;

  constructor({ kv }) {
    super();
    this.#kv = kv;
    this.#value = this.#read();
  }

  get() {
    return structuredClone(this.#value);
  }

  // Aplica un cambio parcial, por ejemplo `{ chatEnabled: false }` o `{ limits: { user: { max: 10 } } }`.
  // Es todo o nada: devuelve false, sin tocar nada, si algún valor no es válido.
  update(patch) {
    if (typeof patch !== 'object' || patch === null) return false;

    const next = structuredClone(this.#value);
    if ('chatEnabled' in patch) {
      if (typeof patch.chatEnabled !== 'boolean') return false;
      next.chatEnabled = patch.chatEnabled;
    }

    if ('localFallback' in patch) {
      if (typeof patch.localFallback !== 'boolean') return false;
      next.localFallback = patch.localFallback;
    }

    for (const scope of LIMIT_SCOPES) {
      const change = patch.limits?.[scope];
      if (change === undefined) continue;
      if (typeof change !== 'object' || change === null) return false;

      if ('enabled' in change) {
        if (typeof change.enabled !== 'boolean') return false;
        next.limits[scope].enabled = change.enabled;
      }
      if ('max' in change) {
        if (!isLimit(change.max)) return false;
        next.limits[scope].max = change.max;
      }
    }

    this.#value = next;
    this.#kv.set(KEY, next);
    this.emit('change');
    return true;
  }

  // Lo guardado puede venir de una versión anterior o estar dañado: cada campo se valida por separado.
  #read() {
    const stored = this.#kv.get(KEY, {});
    const value = structuredClone(DEFAULTS);

    if (typeof stored?.chatEnabled === 'boolean') value.chatEnabled = stored.chatEnabled;
    if (typeof stored?.localFallback === 'boolean') value.localFallback = stored.localFallback;
    for (const scope of LIMIT_SCOPES) {
      const limit = stored?.limits?.[scope];
      if (typeof limit?.enabled === 'boolean') value.limits[scope].enabled = limit.enabled;
      if (isLimit(limit?.max)) value.limits[scope].max = limit.max;
    }
    return value;
  }
}
