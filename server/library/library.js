import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, parse, relative, sep } from 'node:path';
import { createJsonFile } from '../storage/json-file.js';
import { TITLE_MAX_LENGTH } from '../tracks.js';
import { readTags as defaultReadTags } from './tags.js';

export const EXTENSIONS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.wav']);
const MAX_DEPTH = 12;
const MAX_TRACKS = 50000;
const RESCAN_DELAY_MS = 1000;
const TAG_CONCURRENCY = 6;
const TRACK_NUMBER_PATTERN = /^\d{1,3}$/;
// Peso de cada campo en la búsqueda: una coincidencia en el título pesa más que en una nota.
const WEIGHT = { title: 3, artist: 2, album: 1, note: 1, fileName: 1 };
// En la búsqueda estricta, una etiqueta más corta que esto no basta por sí sola.
export const SHORT_TAG_LENGTH = 10;
const EXACT_TITLE_BONUS = 5;
const PREFIX_TITLE_BONUS = 2;

const fold = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Plan B cuando el archivo no tiene etiquetas: "Artista - Título.mp3", o la carpeta como artista.
// Combinaciones de 2 y 3 palabras consecutivas de la búsqueda: «a b c d» → «a b», «b c», «c d», «a b c», «b c d».
function wordCombinations(terms) {
  const phrases = [];
  for (const size of [2, 3]) {
    for (let i = 0; i + size <= terms.length; i++) phrases.push(terms.slice(i, i + size).join(' '));
  }
  return phrases;
}

function describe(relPath) {
  const parts = relPath.split('/');
  const name = parse(parts.at(-1)).name.replace(/_/g, ' ').trim();
  const folder = parts.length > 1 ? parts.at(-2) : null;

  const pieces = name.split(' - ').map((piece) => piece.trim());
  if (pieces.length >= 2 && pieces[0] && !TRACK_NUMBER_PATTERN.test(pieces[0])) {
    return { artist: pieces[0], title: pieces.slice(1).join(' - ') || name };
  }
  // "01 - Título": el número de pista no es un artista.
  const title = pieces.length >= 2 && TRACK_NUMBER_PATTERN.test(pieces[0]) ? pieces.slice(1).join(' - ') : name;
  return { artist: folder, title: title || name };
}

// Los ids salen de la ruta relativa, así que se conservan entre escaneos, reinicios y cambios
// de etiquetas, y no revelan la ruta completa del sistema.
function idFor(relPath) {
  return createHash('sha256').update(relPath).digest('hex').slice(0, 24);
}

// Pista del índice. Las etiquetas mandan sobre el nombre del archivo. Para buscar, cada texto se guarda
// por separado (título, notas como comentarios, descripciones y subtítulos, y nombre de archivo) porque en la
// búsqueda estricta importa la longitud de cada uno. El artista y el álbum van aparte: son los que "respaldan"
// una coincidencia en un texto corto. El nombre de archivo no es una etiqueta y nunca cuenta como largo.
function buildTrack(relPath, tags) {
  const guessed = describe(relPath);
  const title = tags?.title ?? guessed.title;
  const artist = tags?.artist ?? guessed.artist;
  const fileName = parse(relPath).name.replace(/_/g, ' ');
  const texts = [
    { text: fold(title), weight: WEIGHT.title, isTag: true },
    ...(tags?.notes ?? []).map((note) => ({ text: fold(note), weight: WEIGHT.note, isTag: true })),
    { text: fold(fileName), weight: WEIGHT.fileName, isTag: false },
  ];

  return {
    source: 'local',
    localId: idFor(relPath),
    title: title.slice(0, TITLE_MAX_LENGTH),
    artist: artist ? artist.slice(0, TITLE_MAX_LENGTH) : null,
    duration: tags?.duration ?? null,
    relPath,
    fields: { title: fold(title), artist: fold(artist ?? ''), album: fold(tags?.album ?? ''), texts },
  };
}

function compareTracks(a, b) {
  return `${a.artist ?? ''}\u0000${a.title}`.localeCompare(`${b.artist ?? ''}\u0000${b.title}`);
}

function publicView({ source, localId, title, artist, duration }) {
  return { source, localId, title, artist, duration };
}

export class Library extends EventEmitter {
  #file;
  #log;
  #watchEnabled;
  #readTags;
  #root = null;
  #status = 'none';
  #tracks = [];
  #byId = new Map();
  #tagCache = new Map();
  #running = null;
  #again = false;
  #watcher = null;
  #timer = null;

  // `readTags(ruta)` se puede sustituir en las pruebas; por defecto lee las etiquetas con music-metadata.
  constructor({ configPath = null, log = () => {}, watch: watchEnabled = true, readTags = defaultReadTags } = {}) {
    super();
    this.#file = createJsonFile(configPath, { log });
    this.#log = log;
    this.#watchEnabled = watchEnabled;
    this.#readTags = readTags;
  }

  // Lee la carpeta guardada y empieza a escanearla sin esperar al resultado.
  async load() {
    const config = await this.#file.read({});
    if (typeof config?.folder !== 'string') return;

    try {
      await this.#useFolder(config.folder);
    } catch (error) {
      this.#log('library.folderUnavailable', error);
      this.#status = 'error';
    }
  }

  // Cambia la carpeta de música. Lanza un error si no existe o no es una carpeta.
  async setFolder(input) {
    if (typeof input !== 'string' || !isAbsolute(input.trim())) throw new Error('library.notAbsolute');

    const root = await this.#useFolder(input.trim());
    await this.#file.write({ folder: root });
  }

  async #useFolder(input) {
    const root = await realpath(input);
    if (!(await stat(root)).isDirectory()) throw new Error('library.notDirectory');

    this.#root = root;
    this.#status = 'scanning';
    this.#tracks = [];
    this.#byId = new Map();
    this.#tagCache = new Map();
    this.#startWatching();
    this.emit('change');
    this.scan();
    return root;
  }

  get root() {
    return this.#root;
  }

  status() {
    return {
      configured: this.#root !== null,
      folderName: this.#root ? basename(this.#root) : null,
      status: this.#status,
      count: this.#tracks.length,
    };
  }

  // Espera a que acabe el escaneo en curso (útil en pruebas).
  idle() {
    return this.#running ?? Promise.resolve();
  }

  scan() {
    if (!this.#root) return Promise.resolve();
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }

    this.#running = this.#scanUntilStable()
      .catch((error) => {
        this.#log('library.scanFailed', error);
        this.#status = 'error';
        this.emit('change');
      })
      .finally(() => {
        this.#running = null;
      });
    return this.#running;
  }

  async #scanUntilStable() {
    do {
      this.#again = false;
      await this.#scanOnce();
    } while (this.#again);
  }

  // Primero se indexa por nombre de archivo (rápido, ya se puede buscar) y después se leen las
  // etiquetas, reutilizando las de los archivos que no han cambiado desde el escaneo anterior.
  async #scanOnce() {
    const root = this.#root;
    const relPaths = await this.#walk(root);
    if (root !== this.#root) return; // la carpeta cambió mientras se escaneaba

    this.#publish(relPaths.map((relPath) => buildTrack(relPath, this.#tagCache.get(relPath)?.tags ?? null)));

    const tags = await this.#readAllTags(root, relPaths);
    if (root !== this.#root) return;

    this.#publish(relPaths.map((relPath) => buildTrack(relPath, tags.get(relPath) ?? null)), 'ready');
  }

  async #walk(root) {
    const relPaths = [];

    const visit = async (dir, depth) => {
      if (depth > MAX_DEPTH) return;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        this.#log('library.readFailed', error);
        return;
      }

      for (const entry of entries) {
        if (relPaths.length >= MAX_TRACKS) return;
        if (entry.name.startsWith('.')) continue;

        // Los enlaces simbólicos no son ni archivo ni carpeta para Dirent: se ignoran,
        // así el índice nunca apunta fuera de la carpeta configurada.
        if (entry.isDirectory()) {
          await visit(join(dir, entry.name), depth + 1);
        } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          // Rutas relativas siempre con "/": es lo que espera sendFile y da los mismos ids en cualquier sistema.
          relPaths.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
        }
      }
    };
    await visit(root, 0);
    return relPaths;
  }

  // Lee las etiquetas con unas pocas lecturas a la vez. Un archivo ilegible se queda con los datos de su nombre.
  async #readAllTags(root, relPaths) {
    const tags = new Map();
    const nextCache = new Map();
    let next = 0;

    const worker = async () => {
      while (next < relPaths.length && root === this.#root) {
        const relPath = relPaths[next];
        next += 1;

        try {
          const path = join(root, relPath);
          const info = await stat(path);
          const known = this.#tagCache.get(relPath);
          const entry = known && known.mtimeMs === info.mtimeMs && known.size === info.size
            ? known
            : { mtimeMs: info.mtimeMs, size: info.size, tags: await this.#readTags(path) };

          nextCache.set(relPath, entry);
          tags.set(relPath, entry.tags);
        } catch {
          // Sin etiquetas legibles: se usa el nombre del archivo.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TAG_CONCURRENCY, relPaths.length) }, worker));

    if (root === this.#root) this.#tagCache = nextCache;
    return tags;
  }

  #publish(tracks, status = null) {
    tracks.sort(compareTracks);
    this.#tracks = tracks;
    this.#byId = new Map(tracks.map((track) => [track.localId, track]));
    if (status) this.#status = status;
    this.emit('change');
  }

  #startWatching() {
    this.#watcher?.close();
    this.#watcher = null;
    if (!this.#watchEnabled || !this.#root) return;

    try {
      this.#watcher = watch(this.#root, { recursive: true }, () => this.#scheduleRescan());
      this.#watcher.on('error', (error) => {
        this.#log('library.watchFailed', error);
        this.#watcher?.close();
        this.#watcher = null;
      });
    } catch (error) {
      this.#log('library.watchFailed', error);
    }
  }

  #scheduleRescan() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.scan(), RESCAN_DELAY_MS);
    this.#timer.unref();
  }

  // Todas las pistas, ordenadas por artista y título, sin rutas.
  all() {
    return this.#tracks.map(publicView);
  }

  find(id) {
    const track = this.#byId.get(id);
    return track ? publicView(track) : null;
  }

  // Etiquetas de una pista (álbum y notas, que el índice público no incluye), o null si no se leyeron.
  tags(id) {
    const track = this.#byId.get(id);
    const tags = track && this.#tagCache.get(track.relPath)?.tags;
    return tags ? { album: tags.album ?? null, notes: tags.notes ?? [] } : null;
  }

  // Busca por título, artista, álbum, comentarios, descripciones y nombre de archivo, sin distinguir
  // mayúsculas ni acentos. Todos los términos deben aparecer, cada uno en cualquier campo. Con texto,
  // las coincidencias en el título van antes que las del artista y estas antes que las de las notas.
  // `exclude` descarta pistas.
  //
  // Con `strict`, una palabra que solo aparece en textos de menos de 10 caracteres (un título corto, una
  // nota corta o el nombre del archivo) no vale por sí sola: hace falta que otra palabra de la búsqueda
  // coincida con el artista o el álbum. Evita que «love» encuentre cualquier canción que se llame «Love».
  //
  // Con `allowMissing`, la pista no se descarta si faltan hasta esa cantidad de palabras, siempre que
  // coincidan al menos dos. Las que faltan no suman, así que quedan detrás de las que coinciden entera.
  search(query, { limit = 50, exclude = () => false, strict = false, allowMissing = 0 } = {}) {
    const text = fold(String(query ?? '')).trim();
    const terms = text.split(/\s+/).filter(Boolean);
    const phrases = wordCombinations(terms);
    let matches = this.#tracks.filter((track) => !exclude(publicView(track)));
    if (terms.length > 0) {
      matches = matches
        .map((track) => ({ track, score: Library.#score(track, text, terms, phrases, strict, allowMissing) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score) // estable: a igual puntuación se conserva el orden alfabético
        .map(({ track }) => track);
    }
    return { items: matches.slice(0, limit).map(publicView), total: matches.length };
  }

  static #score({ fields }, text, terms, phrases, strict, allowMissing) {
    const matches = terms.map((term) => {
      const inArtist = fields.artist.includes(term);
      const inAlbum = fields.album.includes(term);
      let weight = Math.max(inArtist ? WEIGHT.artist : 0, inAlbum ? WEIGHT.album : 0);
      let standsAlone = inArtist || inAlbum;
      for (const { text: value, weight: textWeight, isTag } of fields.texts) {
        if (!value.includes(term)) continue;
        weight = Math.max(weight, textWeight);
        if (isTag && value.length >= SHORT_TAG_LENGTH) standsAlone = true;
      }
      return { weight, standsAlone, inArtistOrAlbum: inArtist || inAlbum };
    });

    const found = matches.filter(({ weight }) => weight > 0);
    const missing = matches.length - found.length;
    if (missing > allowMissing || (missing > 0 && found.length < 2)) return 0;
    if (strict) {
      const backed = found.some(({ inArtistOrAlbum }) => inArtistOrAlbum);
      if (!backed && found.some(({ standsAlone }) => !standsAlone)) return 0;
    }

    let score = found.reduce((sum, { weight }) => sum + weight, 0);
    // Las combinaciones de 2 y 3 palabras seguidas no son obligatorias (el artista y el título pueden estar en
    // campos distintos), pero si aparecen juntas en un mismo campo suman su peso.
    for (const phrase of phrases) {
      const inArtistOrAlbum = [fields.artist.includes(phrase) && WEIGHT.artist, fields.album.includes(phrase) && WEIGHT.album];
      const inTexts = fields.texts.filter(({ text: value }) => value.includes(phrase)).map(({ weight }) => weight);
      score += Math.max(0, ...inArtistOrAlbum, ...inTexts);
    }
    if (fields.title === text) score += EXACT_TITLE_BONUS;
    else if (fields.title.startsWith(text)) score += PREFIX_TITLE_BONUS;
    return score;
  }

  // Ruta relativa del archivo dentro de la carpeta, o null si el id no existe o el archivo
  // ya no está dentro de ella (por ejemplo, porque lo sustituyeron por un enlace simbólico).
  async resolve(id) {
    const track = this.#byId.get(id);
    if (!track || !this.#root) return null;

    try {
      const real = await realpath(join(this.#root, track.relPath));
      const outside = relative(this.#root, real);
      if (outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside)) return null;
      return track.relPath;
    } catch {
      return null;
    }
  }

  // Espera a que termine el escaneo en curso y a que se guarde la configuración.
  async flush() {
    await this.idle();
    await this.#file.flush();
  }

  close() {
    clearTimeout(this.#timer);
    this.#watcher?.close();
    this.#watcher = null;
  }
}
