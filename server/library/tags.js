import { parseFile } from 'music-metadata';
import { TITLE_MAX_LENGTH } from '../tracks.js';

const MAX_NOTES = 10;
const NOTE_MAX_LENGTH = 500;
// Etiquetas nativas donde se suelen escribir comentarios, descripciones y títulos alternativos
// (COMM, TIT3, TXXX:description, DESCRIPTION, ©cmt, ICMT…) y que no siempre llegan a `common`.
const NOTE_TAG_PATTERN = /desc|alt|comm|cmt|keyword|subtitle|^tit3$/i;

function clean(value, maxLength = TITLE_MAX_LENGTH) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.text === 'string') return value.text;
  return null;
}

// Lee título, artista, álbum, duración y notas (comentarios, descripciones y subtítulos) de un archivo.
// Lanza un error si el archivo no se puede leer como audio.
export async function readTags(path) {
  const { common, format, native } = await parseFile(path, { skipCovers: true });

  const candidates = [
    ...(common.comment ?? []).map(textOf),
    ...(common.description ?? []),
    ...(common.subtitle ?? []),
    ...Object.values(native).flat()
      .filter((tag) => NOTE_TAG_PATTERN.test(tag.id))
      .map((tag) => textOf(tag.value)),
  ];
  const notes = [...new Set(candidates.map((text) => clean(text, NOTE_MAX_LENGTH)).filter(Boolean))].slice(0, MAX_NOTES);

  return {
    title: clean(common.title),
    artist: clean(common.artist ?? common.albumartist),
    album: clean(common.album),
    notes,
    duration: Number.isFinite(format.duration) ? format.duration : null,
  };
}
