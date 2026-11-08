// Utilidades compartidas por las herramientas de etiquetas ID3 de tools/.
import { readFile } from 'fs/promises';
import { basename, extname, resolve, sep } from 'path';
import NodeID3 from 'node-id3';

// Campos que el mapeo puede definir. title/artist/album/genre/subtitle son texto plano;
// year es "AAAA" y track es "N" o "N/Total" (acepta números); comment y description son
// los títulos alternos (ver mapping-enrevision.json). La carátula no se toca.
export const FIELDS = ['title', 'artist', 'album', 'year', 'track', 'genre', 'subtitle', 'comment', 'description'];

const TEXT_FIELDS = ['title', 'artist', 'album', 'genre', 'subtitle', 'comment', 'description'];

// Lee las etiquetas de un archivo y las devuelve en la forma que usa el mapeo.
export function readTags(file) {
  const t = NodeID3.read(file) || {};
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    year: t.year || t.recordingTime,
    track: t.trackNumber,
    genre: t.genre,
    subtitle: t.subtitle,
    comment: typeof t.comment === 'object' ? t.comment?.text : t.comment,
    description: t.userDefinedText?.find(u => u.description === 'DESCRIPTION')?.value,
  };
}

// Convierte una entrada del mapeo en el objeto que espera NodeID3.update.
// Solo incluye los campos definidos, para no tocar el resto de frames.
// Un valor `null` borra el frame (node-id3 elimina los frames con texto vacío).
export function buildTags(entry) {
  const tags = {};
  for (const key of ['title', 'artist', 'album', 'genre', 'subtitle']) {
    if (entry[key] === null) tags[key] = '';
    else if (entry[key]) tags[key] = entry[key];
  }
  // El año vive en dos frames (TYER y TDRC): se escriben juntos para que no quede uno desactualizado.
  if (entry.year === null) {
    tags.year = '';
    tags.recordingTime = '';
  } else if (entry.year !== undefined) {
    tags.year = tags.recordingTime = String(entry.year);
  }
  if (entry.track === null) tags.trackNumber = '';
  else if (entry.track !== undefined) tags.trackNumber = String(entry.track);
  if (entry.comment === null) tags.comment = { language: 'eng', text: '' };
  else if (entry.comment) tags.comment = { language: 'eng', text: entry.comment };
  if (entry.description) {
    // node-id3 usa `value` (no `text`) dentro de userDefinedText.
    tags.userDefinedText = [{ description: 'DESCRIPTION', value: entry.description }];
  }
  return tags;
}

// Valida que el nombre sea un .mp3 plano dentro de `dir` (la carpeta de música no es confiable).
export function resolveMp3(dir, filename) {
  if (basename(filename) !== filename || extname(filename).toLowerCase() !== '.mp3') {
    throw new Error(`Nombre de archivo no válido: ${filename}`);
  }
  const root = resolve(dir);
  const file = resolve(root, filename);
  if (!file.startsWith(root + sep)) {
    throw new Error(`Ruta fuera de la carpeta: ${filename}`);
  }
  return file;
}

export async function loadMapping(path) {
  const mapping = JSON.parse(await readFile(path, 'utf8'));
  for (const [filename, entry] of Object.entries(mapping)) {
    for (const [key, value] of Object.entries(entry)) {
      if (!FIELDS.includes(key)) throw new Error(`Campo desconocido "${key}" en ${filename}`);
      if (value === null) continue; // null borra la etiqueta
      if (key === 'year' && !/^\d{4}$/.test(String(value))) {
        throw new Error(`year debe ser un año de 4 cifras en ${filename}: ${JSON.stringify(value)}`);
      }
      if (key === 'track' && !/^\d+(\/\d+)?$/.test(String(value))) {
        throw new Error(`track debe ser "N" o "N/Total" en ${filename}: ${JSON.stringify(value)}`);
      }
      if (TEXT_FIELDS.includes(key) && typeof value !== 'string') {
        throw new Error(`${key} debe ser texto o null en ${filename}: ${JSON.stringify(value)}`);
      }
    }
  }
  return mapping;
}

// Compara un valor leído con el del mapeo ignorando el tipo (el año o la pista pueden venir como número).
export function sameValue(actual, expected) {
  const text = v => (v === undefined || v === null ? null : String(v));
  return text(actual) === text(expected);
}
