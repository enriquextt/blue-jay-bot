import { EventEmitter } from 'node:events';
import { LOCALES } from './index.js';

export const MAX_LENGTH = 400;
const KEY = 'messages';
const PREFIX = 'chat';
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{([^}]*)\}\}/g;

// Recorre un objeto de traducciones y devuelve sus textos con la clave completa ("chat.sr.added").
function flatten(object, prefix) {
  return Object.entries(object).flatMap(([name, value]) => {
    const key = `${prefix}.${name}`;
    return typeof value === 'object' ? flatten(value, key) : [[key, value]];
  });
}

function placeholdersIn(text) {
  return [...text.matchAll(PLACEHOLDER)].map(([, name]) => name.trim());
}

// Mensajes del bot en el chat (las claves `chat.*` de los archivos de idioma) que se pueden reescribir o
// desactivar desde el panel. Un mensaje es una clave tal como la usa el código (`chat.when.position`); si
// tiene plurales (`_one`, `_other`) cada forma se edita por separado, pero se activa o desactiva todo junto.
export class Messages extends EventEmitter {
  #kv;
  #defaults = new Map();
  #items = [];
  #custom = Object.fromEntries(LOCALES.map((locale) => [locale, new Map()]));
  #disabled = new Set();

  constructor({ kv, locales }) {
    super();
    this.#kv = kv;

    const byKey = new Map();
    for (const locale of LOCALES) {
      for (const [leaf, text] of flatten(locales[locale][PREFIX] ?? {}, PREFIX)) {
        this.#defaults.set(`${locale}:${leaf}`, text);
        const key = leaf.replace(PLURAL_SUFFIX, '');
        const item = byKey.get(key) ?? { key, forms: new Map(), params: new Set() };
        item.forms.set(leaf, leaf.match(PLURAL_SUFFIX)?.[1] ?? null);
        placeholdersIn(text).forEach((name) => item.params.add(name));
        if (key !== leaf) item.params.add('count');
        byKey.set(key, item);
      }
    }
    this.#items = [...byKey.values()];

    this.#load();
  }

  isEnabled(key) {
    return !this.#disabled.has(key);
  }

  // Todas las claves de texto (con su sufijo de plural), para cargarlas en el traductor.
  leaves() {
    return this.#items.flatMap((item) => [...item.forms.keys()]);
  }

  // Texto que se usa ahora: el personalizado o, si no hay, el original.
  text(locale, leaf) {
    return this.#custom[locale].get(leaf) ?? this.#defaults.get(`${locale}:${leaf}`);
  }

  list() {
    return this.#items.map((item) => ({
      key: item.key,
      enabled: this.isEnabled(item.key),
      params: [...item.params],
      forms: [...item.forms].map(([leaf, form]) => ({
        leaf,
        form,
        defaults: Object.fromEntries(LOCALES.map((locale) => [locale, this.#defaults.get(`${locale}:${leaf}`)])),
        custom: Object.fromEntries(LOCALES.flatMap((locale) => (this.#custom[locale].has(leaf) ? [[locale, this.#custom[locale].get(leaf)]] : []))),
      })),
    }));
  }

  // Cambia el texto de una forma en un idioma. Un texto vacío o igual al original vuelve al original.
  // Devuelve false, sin cambiar nada, si la clave no existe o el texto no es válido.
  setText(locale, leaf, text) {
    const original = this.#defaults.get(`${locale}:${leaf}`);
    if (original === undefined || typeof text !== 'string') return false;

    const clean = this.#validate(leaf, text);
    if (clean === null) return false;

    if (clean === '' || clean === original) this.#custom[locale].delete(leaf);
    else this.#custom[locale].set(leaf, clean);

    this.#save();
    return true;
  }

  setEnabled(key, enabled) {
    if (!this.#items.some((item) => item.key === key) || typeof enabled !== 'boolean') return false;

    if (enabled) this.#disabled.delete(key);
    else this.#disabled.add(key);

    this.#save();
    return true;
  }

  // Devuelve un mensaje a su texto original en todos los idiomas y lo vuelve a activar.
  reset(key) {
    const item = this.#items.find((candidate) => candidate.key === key);
    if (!item) return false;

    for (const leaf of item.forms.keys()) {
      for (const locale of LOCALES) this.#custom[locale].delete(leaf);
    }
    this.#disabled.delete(key);

    this.#save();
    return true;
  }

  // Devuelve el texto en una sola línea y recortado, '' si está vacío, o null si no es válido: demasiado largo,
  // con una variable que el mensaje no tiene o con otra sintaxis de i18next (anidados, formatos).
  #validate(leaf, text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length > MAX_LENGTH || clean.includes('$t(')) return null;

    const allowed = this.#items.find((item) => item.forms.has(leaf)).params;
    if (!placeholdersIn(clean).every((name) => allowed.has(name))) return null;
    if (clean.replace(PLACEHOLDER, '').match(/\{\{|\}\}/)) return null;
    return clean;
  }

  #load() {
    const stored = this.#kv.get(KEY, {});

    for (const locale of LOCALES) {
      for (const [leaf, text] of Object.entries(stored?.custom?.[locale] ?? {})) {
        const original = this.#defaults.get(`${locale}:${leaf}`);
        const clean = original !== undefined && typeof text === 'string' ? this.#validate(leaf, text) : null;
        if (clean && clean !== original) this.#custom[locale].set(leaf, clean);
      }
    }
    for (const key of Array.isArray(stored?.disabled) ? stored.disabled : []) {
      if (this.#items.some((item) => item.key === key)) this.#disabled.add(key);
    }
  }

  #save() {
    this.#kv.set(KEY, {
      custom: Object.fromEntries(LOCALES.map((locale) => [locale, Object.fromEntries(this.#custom[locale])])),
      disabled: [...this.#disabled],
    });
    this.emit('change');
  }
}
