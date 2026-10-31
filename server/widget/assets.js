import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSET_ID } from '../../public/js/widget/catalog.js';

export const ASSET_LIMITS = {
  count: 50,
  totalBytes: 50 * 1024 * 1024,
  imageBytes: 2 * 1024 * 1024,
  nameLength: 60,
};

const KEY = 'widget.assets';

// Tipos admitidos y cómo reconocerlos por sus primeros bytes: ni la extensión ni la cabecera `Content-Type` valen,
// las pone quien sube el archivo. SVG queda fuera a propósito: podría llevar scripts si se abriera como página.
const SIGNATURES = [
  { type: 'image/png', ext: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', ext: 'gif', matches: (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { type: 'image/webp', ext: 'webp', matches: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function detectImage(buffer) {
  return SIGNATURES.find((signature) => signature.matches(buffer)) ?? null;
}

// El nombre original solo se muestra en el editor: se limpia y se recorta.
function cleanName(name) {
  const text = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, ASSET_LIMITS.nameLength) || 'imagen';
}

export class AssetError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Imágenes subidas para el widget. El id es el SHA-256 del contenido (recortado), así que subir lo mismo dos veces
// da el mismo activo, el cliente nunca elige una ruta y el archivo se puede servir con caché eterna. El índice
// (id, tipo, tamaño y nombre) va a la tabla `kv`; los bytes, a `dir` (o a memoria si no hay carpeta, como en las pruebas).
export class WidgetAssets extends EventEmitter {
  #kv;
  #dir;
  #items;
  #memory = new Map();

  constructor({ kv, dir = null }) {
    super();
    this.#kv = kv;
    this.#dir = dir;
    this.#items = this.#read();
  }

  list() {
    return this.#items.map(({ id, name, type, size }) => ({ id, name, type, size }));
  }

  has(id) {
    return this.#items.some((item) => item.id === id);
  }

  // Guarda una imagen. Lanza `AssetError` con `invalid` (no es una imagen admitida), `tooLarge` o `limit`.
  async add(buffer, name) {
    const image = Buffer.isBuffer(buffer) ? detectImage(buffer) : null;
    if (!image) throw new AssetError('invalid');
    if (buffer.length > ASSET_LIMITS.imageBytes) throw new AssetError('tooLarge');

    const id = createHash('sha256').update(buffer).digest('hex').slice(0, 32);
    const existing = this.#items.find((item) => item.id === id);
    if (existing) return { id, name: existing.name, type: existing.type, size: existing.size };

    const total = this.#items.reduce((sum, item) => sum + item.size, 0);
    if (this.#items.length >= ASSET_LIMITS.count || total + buffer.length > ASSET_LIMITS.totalBytes) throw new AssetError('limit');

    const item = { id, name: cleanName(name), type: image.type, ext: image.ext, size: buffer.length };
    if (this.#dir) {
      await mkdir(this.#dir, { recursive: true });
      await writeFile(this.#path(item), buffer);
    } else {
      this.#memory.set(id, buffer);
    }
    this.#items.push(item);
    this.#persist();
    return { id, name: item.name, type: item.type, size: item.size };
  }

  // Los bytes y el tipo de una imagen, o null si no existe (o el archivo ya no está en disco).
  async read(id) {
    const item = typeof id === 'string' && ASSET_ID.test(id) ? this.#items.find((candidate) => candidate.id === id) : null;
    if (!item) return null;

    try {
      return { type: item.type, buffer: this.#dir ? await readFile(this.#path(item)) : this.#memory.get(id) ?? null };
    } catch {
      return null;
    }
  }

  async remove(id) {
    const index = this.#items.findIndex((item) => item.id === id);
    if (index === -1) return false;

    const [item] = this.#items.splice(index, 1);
    this.#memory.delete(id);
    if (this.#dir) await rm(this.#path(item), { force: true });
    this.#persist();
    return true;
  }

  // El nombre del archivo sale del id y de una extensión fija: nunca de lo que mande el cliente.
  #path({ id, ext }) {
    return join(this.#dir, `${id}.${ext}`);
  }

  #persist() {
    this.#kv.set(KEY, this.#items);
    this.emit('change');
  }

  #read() {
    const stored = this.#kv.get(KEY, []);
    if (!Array.isArray(stored)) return [];

    const known = new Map(SIGNATURES.map((signature) => [signature.type, signature.ext]));
    return stored.filter((item) => item && typeof item.id === 'string' && ASSET_ID.test(item.id)
      && known.get(item.type) === item.ext && Number.isInteger(item.size) && typeof item.name === 'string');
  }
}
