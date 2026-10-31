import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../../public/js/widget/catalog.js';
import { CLASSIC_ID, TEMPLATES } from '../../public/js/widget/templates.js';
import { normalizeLayout, usedAssets } from './layout.js';

const LAYOUTS_KEY = 'widget.layouts';
const ACTIVE_KEY = 'widget.active';

// Los layouts de serie se normalizan igual que los del usuario, así que el editor y el widget los tratan igual.
const BUILTIN = TEMPLATES.map((template) => ({ id: template.id, ...normalizeLayout(template), builtin: true }));

// Layouts del widget: los de serie (solo lectura) y los del usuario (en la tabla `kv`), con cuál se usa por defecto.
export class WidgetLayouts extends EventEmitter {
  #kv;
  #assets;
  #custom;
  #active;

  // `assets` (opcional) es quien guarda las imágenes: al guardar un layout se comprueba que las que usa existen.
  constructor({ kv, assets = null }) {
    super();
    this.#kv = kv;
    this.#assets = assets;
    this.#custom = this.#read();
    this.#active = this.#readActive();
  }

  list() {
    return structuredClone([...BUILTIN, ...this.#custom]);
  }

  // Ids de las imágenes que usa algún layout.
  usedAssets() {
    return new Set(this.list().flatMap(usedAssets));
  }

  activeId() {
    return this.#active;
  }

  get(id) {
    return this.list().find((layout) => layout.id === id) ?? null;
  }

  // El layout que pide un widget con `?layout=`; si no existe (o no pide ninguno), el activo.
  resolve(id = null) {
    return this.get(id) ?? this.get(this.#active);
  }

  // Crea un layout o, si `id` es el de uno propio, lo reemplaza. Un id desconocido o de serie crea uno nuevo (guardar como).
  // Devuelve el layout guardado, o null si no es válido o ya hay demasiados.
  save({ id = null, ...input }) {
    const layout = normalizeLayout(input, { hasAsset: this.#assets ? (assetId) => this.#assets.has(assetId) : null });
    if (!layout) return null;

    const index = this.#custom.findIndex((item) => item.id === id);
    if (index === -1 && this.#custom.length >= LIMITS.layouts) return null;

    const saved = { id: index === -1 ? randomUUID() : id, ...layout, builtin: false };
    if (index === -1) this.#custom.push(saved);
    else this.#custom[index] = saved;

    this.#persist();
    return structuredClone(saved);
  }

  // Copia cualquier layout (también uno de serie) con otro nombre. Devuelve la copia, o null si no se puede.
  duplicate(id, name) {
    const source = this.get(id);
    if (!source) return null;

    const { id: _id, builtin: _builtin, ...rest } = source;
    return this.save({ ...rest, name });
  }

  remove(id) {
    const index = this.#custom.findIndex((item) => item.id === id);
    if (index === -1) return false;

    this.#custom.splice(index, 1);
    if (this.#active === id) {
      this.#active = CLASSIC_ID;
      this.#kv.set(ACTIVE_KEY, this.#active);
    }
    this.#persist();
    return true;
  }

  activate(id) {
    if (!this.get(id)) return false;

    this.#active = id;
    this.#kv.set(ACTIVE_KEY, id);
    this.emit('change');
    return true;
  }

  #persist() {
    this.#kv.set(LAYOUTS_KEY, this.#custom.map(({ builtin: _builtin, ...layout }) => layout));
    this.emit('change');
  }

  // Lo guardado puede venir de una versión anterior o estar dañado: lo que no sea válido se descarta.
  #read() {
    const stored = this.#kv.get(LAYOUTS_KEY, []);
    if (!Array.isArray(stored)) return [];

    const seen = new Set(BUILTIN.map((layout) => layout.id));
    const layouts = [];
    for (const { id, ...input } of stored) {
      const layout = normalizeLayout(input);
      if (!layout || typeof id !== 'string' || seen.has(id) || layouts.length >= LIMITS.layouts) continue;

      seen.add(id);
      layouts.push({ id, ...layout, builtin: false });
    }
    return layouts;
  }

  #readActive() {
    const id = this.#kv.get(ACTIVE_KEY, CLASSIC_ID);
    return typeof id === 'string' && (BUILTIN.some((layout) => layout.id === id) || this.#custom.some((layout) => layout.id === id)) ? id : CLASSIC_ID;
  }
}
