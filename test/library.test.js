import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library, SHORT_TAG_LENGTH } from '../server/library/library.js';
import { readTags } from '../server/library/tags.js';
import { BaseList } from '../server/baselist/base-list.js';
import { toEntry, trackKey } from '../server/tracks.js';

// Carpeta de música de prueba. Devuelve la ruta y una función que la borra.
async function makeMusicDir() {
  const base = await mkdtemp(join(tmpdir(), 'bluejay-music-'));
  const root = join(base, 'musica');
  await mkdir(join(root, 'Rock'), { recursive: true });
  await mkdir(join(root, 'Álbum'), { recursive: true });
  await mkdir(join(root, '.oculta'), { recursive: true });

  const files = [
    'Artista Uno - Canción A.mp3',
    'Rock/Banda - Tema Ñandú.flac',
    'Álbum/01 - Intro.ogg',
    'Sin_Artista.wav',
    'notas.txt',
    'portada.jpg',
    '.oculta/escondida.mp3',
  ];
  for (const file of files) await writeFile(join(root, file), 'datos');

  return { base, root, cleanup: () => rm(base, { recursive: true, force: true }) };
}

async function openLibrary(root, options = {}) {
  const library = new Library({ watch: false, log: () => {}, ...options });
  await library.setFolder(root);
  await library.idle();
  return library;
}

test('escanea de forma recursiva solo los formatos de audio y omite archivos ocultos', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    assert.deepEqual(library.status(), { configured: true, folderName: 'musica', status: 'ready', count: 4 });

    const described = library.all().map(({ artist, title }) => `${artist} | ${title}`).sort();
    assert.deepEqual(described, [
      'Artista Uno | Canción A',
      'Banda | Tema Ñandú',
      'null | Sin Artista',
      'Álbum | Intro',
    ].sort());
  } finally {
    await cleanup();
  }
});

test('los ids se conservan entre escaneos, no contienen la ruta y las vistas públicas no la exponen', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    const before = library.all().map((track) => track.localId);

    library.scan();
    await library.idle();
    assert.deepEqual(library.all().map((track) => track.localId), before);

    for (const id of before) assert.match(id, /^[a-f0-9]{24}$/);
    const serialized = JSON.stringify(library.all()) + JSON.stringify(library.status());
    assert.ok(!serialized.includes(root));
    assert.ok(!serialized.includes('relPath'));
  } finally {
    await cleanup();
  }
});

test('el artista sale del nombre o de la carpeta, y el número de pista no cuenta como artista', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    const intro = library.search('intro').items[0];
    assert.equal(intro.artist, 'Álbum');
    assert.equal(intro.title, 'Intro');

    const loose = library.search('sin artista').items[0];
    assert.equal(loose.artist, null);
  } finally {
    await cleanup();
  }
});

test('search ignora mayúsculas y acentos, exige todos los términos y respeta límite y exclusiones', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);

    assert.equal(library.search('CANCION').total, 1);
    assert.equal(library.search('nandu banda').items[0].title, 'Tema Ñandú');
    assert.equal(library.search('nandu uno').total, 0);
    assert.equal(library.search('').total, 4);
    assert.equal(library.search('', { limit: 2 }).items.length, 2);

    const excluded = library.search('', { exclude: (track) => track.artist === 'Banda' });
    assert.equal(excluded.total, 3);
  } finally {
    await cleanup();
  }
});

test('un rescan detecta archivos añadidos y borrados', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    await writeFile(join(root, 'Nueva - Pista.mp3'), 'datos');
    await unlink(join(root, 'Sin_Artista.wav'));

    library.scan();
    await library.idle();
    assert.equal(library.status().count, 4);
    assert.equal(library.search('pista').total, 1);
    assert.equal(library.search('sin artista').total, 0);
  } finally {
    await cleanup();
  }
});

test('resolve devuelve la ruta relativa solo para ids del índice', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    const track = library.search('canción a').items[0];

    assert.equal(await library.resolve(track.localId), 'Artista Uno - Canción A.mp3');
    assert.equal(await library.resolve('0'.repeat(24)), null);
    assert.equal(await library.resolve('../../etc/passwd'), null);
    assert.equal(await library.resolve(undefined), null);
  } finally {
    await cleanup();
  }
});

test('los enlaces simbólicos no se indexan y una carpeta sustituida por un enlace hacia fuera no se sirve', async (t) => {
  const { base, root, cleanup } = await makeMusicDir();
  try {
    const outside = join(base, 'fuera');
    await mkdir(outside);
    await writeFile(join(outside, 'secreto.mp3'), 'secreto');
    await writeFile(join(outside, 'Banda - Tema Ñandú.flac'), 'secreto');

    try {
      await symlink(outside, join(root, 'enlace'), 'junction');
    } catch {
      return t.skip('sin permiso para crear enlaces simbólicos en este sistema');
    }

    const library = await openLibrary(root);
    assert.equal(library.search('secreto').total, 0);

    // Una carpeta indexada se sustituye por un enlace a una carpeta de fuera con un archivo del mismo nombre.
    const track = library.search('nandu').items[0];
    assert.equal(await library.resolve(track.localId), 'Rock/Banda - Tema Ñandú.flac');

    await rm(join(root, 'Rock'), { recursive: true });
    await symlink(outside, join(root, 'Rock'), 'junction');
    assert.equal(await library.resolve(track.localId), null);
  } finally {
    await cleanup();
  }
});

test('setFolder rechaza rutas relativas, inexistentes o que no son carpetas', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = new Library({ watch: false, log: () => {} });
    await assert.rejects(library.setFolder('musica'));
    await assert.rejects(library.setFolder(join(root, 'no-existe')));
    await assert.rejects(library.setFolder(join(root, 'notas.txt')));
    await assert.rejects(library.setFolder(42));
    assert.equal(library.status().configured, false);
  } finally {
    await cleanup();
  }
});

test('la carpeta elegida se guarda y se recupera al arrancar', async () => {
  const { base, root, cleanup } = await makeMusicDir();
  try {
    const configPath = join(base, 'data', 'library.json');
    const first = await openLibrary(root, { configPath });
    await first.setFolder(root);

    assert.equal(typeof JSON.parse(await readFile(configPath, 'utf8')).folder, 'string');

    const second = new Library({ configPath, watch: false, log: () => {} });
    await second.load();
    await second.idle();
    assert.equal(second.status().count, 4);

    const missing = new Library({ configPath: join(base, 'ninguno.json'), watch: false });
    await missing.load();
    assert.equal(missing.status().status, 'none');
  } finally {
    await cleanup();
  }
});

test('la lista base mezcla pistas locales y, si se pide, toda la biblioteca sin vetadas', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    const banned = new Set();
    const baseList = new BaseList({ library, isBanned: (key) => banned.has(key) });

    baseList.start('sequential');
    assert.equal(baseList.next(), null, 'sin pistas ni biblioteca no hay nada que poner');

    baseList.setIncludeLibrary(true);
    const all = library.all();
    banned.add(trackKey(all[0]));

    const played = [];
    for (let i = 0; i < all.length - 1; i += 1) played.push(baseList.next().localId);
    assert.deepEqual(played.sort(), all.slice(1).map((track) => track.localId).sort());
    assert.ok(!played.includes(all[0].localId));
  } finally {
    await cleanup();
  }
});

test('una pista local de la lista base cuyo archivo ya no está en la biblioteca se salta sin borrarla', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root);
    const present = library.search('canción a').items[0];
    const baseList = new BaseList({ library });

    const missing = { source: 'local', localId: 'a'.repeat(24), title: 'Fantasma', artist: null };
    baseList.addMany([missing, toEntry(present)]);
    baseList.start('sequential');

    assert.equal(baseList.next().localId, present.localId);
    assert.equal(baseList.list().length, 2, 'la pista ausente sigue en la lista');
  } finally {
    await cleanup();
  }
});

// --- Etiquetas ---

function frame(id, body) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

const latin = (text) => Buffer.from(text, 'latin1');
const textFrame = (id, text) => frame(id, Buffer.concat([Buffer.from([0]), latin(text)]));

// MP3 mínimo y válido: etiqueta ID3v2.3 seguida de 40 marcos MPEG (unos 1,04 s de audio).
function makeTaggedMp3({ title, artist, album, comment, description, subtitle }) {
  const frames = Buffer.concat([
    textFrame('TIT2', title),
    textFrame('TPE1', artist),
    textFrame('TALB', album),
    frame('COMM', Buffer.concat([Buffer.from([0]), latin('eng\0'), latin(comment)])),
    textFrame('TIT3', subtitle),
    frame('TXXX', Buffer.concat([Buffer.from([0]), latin('description\0'), latin(description)])),
  ]);
  const size = frames.length;
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127]);
  const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
  return Buffer.concat([header, frames, ...Array.from({ length: 40 }, () => mpegFrame)]);
}

const RICK = {
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  album: 'Whenever You Need Somebody',
  comment: 'rickroll; alt: Nunca te voy a dejar',
  description: 'cancion para troll',
  subtitle: 'version original',
};

async function makeFilesDir(names) {
  const base = await mkdtemp(join(tmpdir(), 'bluejay-tags-'));
  for (const name of names) await writeFile(join(base, name), 'datos');
  return { root: base, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('readTags lee título, artista, álbum, duración y notas (comentario, subtítulo y descripción)', async () => {
  const { root, cleanup } = await makeFilesDir([]);
  try {
    await writeFile(join(root, 'cualquiera.mp3'), makeTaggedMp3(RICK));
    const tags = await readTags(join(root, 'cualquiera.mp3'));

    assert.equal(tags.title, RICK.title);
    assert.equal(tags.artist, RICK.artist);
    assert.equal(tags.album, RICK.album);
    assert.equal(tags.subtitle, RICK.subtitle);
    assert.ok(tags.duration > 0.9 && tags.duration < 1.2, `duración ${tags.duration}`);
    // La descripción (TXXX) solo está en las etiquetas nativas, no en `common`.
    assert.deepEqual([...tags.notes].sort(), ['cancion para troll', 'rickroll; alt: Nunca te voy a dejar', 'version original']);

    await writeFile(join(root, 'roto.mp3'), 'esto no es audio');
    // Un archivo que no es audio o bien se rechaza o bien devuelve etiquetas vacías; en ambos casos
    // el índice usa los datos del nombre del archivo.
    const broken = await readTags(join(root, 'roto.mp3')).catch(() => null);
    assert.ok(broken === null || (broken.title === null && broken.artist === null && broken.notes.length === 0));
  } finally {
    await cleanup();
  }
});

test('con etiquetas reales, mandan sobre el nombre del archivo y la búsqueda usa comentario, descripción y subtítulo', async () => {
  const { root, cleanup } = await makeFilesDir(['Sin etiquetas - Otra cosa.mp3']);
  try {
    await writeFile(join(root, 'xyz.mp3'), makeTaggedMp3(RICK));

    const library = await openLibrary(root);
    const rick = library.search('give you up').items[0];
    assert.equal(rick.title, RICK.title);
    assert.equal(rick.artist, RICK.artist);
    assert.ok(rick.duration > 0.9);

    for (const query of ['rickroll', 'nunca te voy', 'troll', 'version original', 'whenever', 'xyz']) {
      assert.equal(library.search(query).items[0]?.localId, rick.localId, query);
    }

    const tags = library.tags(rick.localId);
    assert.equal(tags.album.toLowerCase().includes('whenever'), true);
    assert.equal(tags.notes.length > 0, true);

    // El archivo ilegible se queda con los datos de su nombre y duración desconocida.
    const plain = library.search('otra cosa').items[0];
    assert.equal(plain.artist, 'Sin etiquetas');
    assert.equal(plain.duration, null);
    assert.deepEqual(library.tags(plain.localId), { subtitle: null, album: null, notes: [] });
    assert.equal(library.tags('no-existe'), null);
    assert.equal(library.status().status, 'ready');
  } finally {
    await cleanup();
  }
});

function fakeReader(tagsByName, calls = []) {
  return async (path) => {
    const name = path.split(/[\\/]/).at(-1);
    calls.push(name);
    if (!(name in tagsByName)) throw new Error('sin etiquetas');
    return tagsByName[name];
  };
}

const FAKE_TAGS = {
  'archivo-a.mp3': { title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever', notes: ['rickroll', 'Nunca te voy a dejar'], duration: 213 },
  'archivo-b.mp3': { title: 'Rick', artist: 'Otro', album: null, notes: [], duration: null },
  'archivo-c.mp3': { title: 'Canción', artist: 'Rick Astley', album: null, notes: [], duration: 90 },
};

test('la búsqueda ordena por relevancia: título, luego artista y luego notas', async () => {
  const { root, cleanup } = await makeFilesDir(Object.keys(FAKE_TAGS));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(FAKE_TAGS) });

    const titles = library.search('rick').items.map((track) => `${track.artist}|${track.title}`);
    assert.deepEqual(titles, ['Otro|Rick', 'Rick Astley|Canción', 'Rick Astley|Never Gonna Give You Up']);

    assert.deepEqual(library.search('rickroll').items.map((track) => track.title), ['Never Gonna Give You Up']);
    assert.deepEqual(library.search('gonna rick').items.map((track) => track.title), ['Never Gonna Give You Up']);
    assert.equal(library.search('rick unicornio').total, 0);
    assert.equal(library.search('').total, 3);
  } finally {
    await cleanup();
  }
});

test('las combinaciones de 2 y 3 palabras seguidas suben la puntuación sin ser obligatorias', async () => {
  const tags = {
    'archivo-a.mp3': { title: 'Give Up Never', artist: 'Uno', album: null, notes: [], duration: null },
    'archivo-b.mp3': { title: 'Never Give Up', artist: 'Dos', album: null, notes: [], duration: null },
    'archivo-c.mp3': { title: 'Canción', artist: 'Never', album: null, notes: ['give up'], duration: null },
  };
  const { root, cleanup } = await makeFilesDir(Object.keys(tags));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(tags) });

    const titles = library.search('never give up').items.map((track) => track.title);
    assert.deepEqual(titles, ['Never Give Up', 'Give Up Never', 'Canción']);
  } finally {
    await cleanup();
  }
});

test('allowMissing tolera palabras sin coincidencia si al menos dos coinciden y las deja detrás', async () => {
  const { root, cleanup } = await makeFilesDir(Object.keys(FAKE_TAGS));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(FAKE_TAGS) });
    const titles = (query, options) => library.search(query, options).items.map((track) => track.title);

    assert.deepEqual(titles('rick astley gonna sub'), []);
    assert.deepEqual(titles('rick astley gonna sub', { allowMissing: 1 }), ['Never Gonna Give You Up']);
    assert.deepEqual(titles('rick sub', { allowMissing: 1 }), []); // solo coincide una palabra
    assert.deepEqual(titles('rick astley sub otro', { allowMissing: 1 }), []); // faltan dos
    // con el modo estricto sigue haciendo falta respaldo del artista o el álbum
    assert.deepEqual(titles('gonna give sub', { allowMissing: 1, strict: true }), ['Never Gonna Give You Up']);
  } finally {
    await cleanup();
  }
});

test('las etiquetas solo se vuelven a leer en los archivos nuevos o modificados', async () => {
  const { root, cleanup } = await makeFilesDir(Object.keys(FAKE_TAGS));
  try {
    const calls = [];
    const library = await openLibrary(root, { readTags: fakeReader(FAKE_TAGS, calls) });
    assert.equal(calls.length, 3);

    library.scan();
    await library.idle();
    assert.equal(calls.length, 3, 'sin cambios no se lee nada');

    await writeFile(join(root, 'archivo-b.mp3'), 'contenido distinto y más largo');
    library.scan();
    await library.idle();
    assert.deepEqual(calls.slice(3), ['archivo-b.mp3']);
  } finally {
    await cleanup();
  }
});

test('la biblioteca ya se puede buscar por nombre mientras se leen las etiquetas', async () => {
  const { root, cleanup } = await makeFilesDir(Object.keys(FAKE_TAGS));
  try {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const library = new Library({
      watch: false,
      log: () => {},
      readTags: async () => {
        await gate;
        return { title: 'Etiquetado', artist: null, album: null, notes: [], duration: 10 };
      },
    });
    await library.setFolder(root);

    await new Promise((resolve) => {
      const check = () => (library.status().count === 3 ? resolve() : library.once('change', check));
      check();
    });
    assert.equal(library.status().status, 'scanning');
    assert.equal(library.search('archivo').total, 3);

    release();
    await library.idle();
    assert.equal(library.status().status, 'ready');
    assert.equal(library.search('etiquetado').total, 3);
    assert.equal(library.search('archivo').total, 3, 'el nombre del archivo sigue contando');
  } finally {
    await cleanup();
  }
});

// --- Búsqueda estricta: las etiquetas cortas necesitan respaldo del artista o del álbum ---

const STRICT_TAGS = {
  'archivo-a.mp3': { title: 'Love', artist: 'Beatles', album: 'Past Masters', notes: ['hit'], duration: 150 },
  'archivo-b.mp3': { title: 'Love', artist: 'Nat King Cole', album: null, notes: [], duration: 130 },
  'archivo-c.mp3': {
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    album: null,
    notes: ['rickroll', 'Nunca te voy a dejar'],
    duration: 213,
  },
};

const strictIds = (library, query) => library.search(query, { strict: true }).items
  .map((track) => `${track.artist}|${track.title}`);

test('en la búsqueda estricta, un título corto no basta: hace falta que coincida también el artista o el álbum', async () => {
  const { root, cleanup } = await makeFilesDir(Object.keys(STRICT_TAGS));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(STRICT_TAGS) });

    assert.deepEqual(strictIds(library, 'love'), [], 'dos pistas se llaman Love y ninguna está respaldada');
    assert.equal(library.search('love').total, 2, 'sin strict (el panel) se siguen encontrando');

    assert.deepEqual(strictIds(library, 'love beatles'), ['Beatles|Love']);
    assert.deepEqual(strictIds(library, 'love cole'), ['Nat King Cole|Love']);
    assert.deepEqual(strictIds(library, 'love masters'), ['Beatles|Love'], 'el álbum también respalda');
    assert.deepEqual(strictIds(library, 'beatles'), ['Beatles|Love'], 'buscar solo por artista no tiene restricción');
    assert.deepEqual(strictIds(library, 'past masters'), ['Beatles|Love'], 'ni solo por álbum');
  } finally {
    await cleanup();
  }
});

test('las notas cortas y el nombre del archivo también necesitan respaldo; las etiquetas largas valen solas', async () => {
  const { root, cleanup } = await makeFilesDir(Object.keys(STRICT_TAGS));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(STRICT_TAGS) });

    assert.deepEqual(strictIds(library, 'hit'), [], 'nota de 3 caracteres');
    assert.deepEqual(strictIds(library, 'hit beatles'), ['Beatles|Love']);

    assert.deepEqual(strictIds(library, 'rickroll'), [], 'nota de 8 caracteres');
    assert.deepEqual(strictIds(library, 'rickroll rick'), ['Rick Astley|Never Gonna Give You Up']);

    assert.deepEqual(strictIds(library, 'nunca te voy'), ['Rick Astley|Never Gonna Give You Up'], 'nota de 20 caracteres');
    assert.deepEqual(strictIds(library, 'never gonna give you up'), ['Rick Astley|Never Gonna Give You Up'], 'título de 23');

    assert.deepEqual(strictIds(library, 'archivo'), [], 'el nombre del archivo nunca vale solo');
    assert.equal(library.search('archivo').total, 3);
    assert.deepEqual(strictIds(library, 'archivo-c astley'), ['Rick Astley|Never Gonna Give You Up']);
  } finally {
    await cleanup();
  }
});

test('el límite es de 10 caracteres: con 9 hace falta respaldo y con 10 no', async () => {
  const tags = {
    'archivo-a.mp3': { title: '123456789', artist: 'Uno', album: null, notes: [], duration: null },
    'archivo-b.mp3': { title: '1234567890', artist: 'Dos', album: null, notes: [], duration: null },
  };
  const { root, cleanup } = await makeFilesDir(Object.keys(tags));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(tags) });

    assert.deepEqual(strictIds(library, '12345'), ['Dos|1234567890']);
    assert.deepEqual(strictIds(library, '12345 uno'), ['Uno|123456789']);
    assert.equal(SHORT_TAG_LENGTH, 10);
  } finally {
    await cleanup();
  }
});

test('la regla estricta cuenta los acentos y las mayúsculas igual que la búsqueda normal', async () => {
  const tags = {
    'archivo-a.mp3': { title: 'Canción', artist: 'Ñandú Jr', album: null, notes: [], duration: null },
  };
  const { root, cleanup } = await makeFilesDir(Object.keys(tags));
  try {
    const library = await openLibrary(root, { readTags: fakeReader(tags) });

    assert.deepEqual(strictIds(library, 'CANCION'), []);
    assert.deepEqual(strictIds(library, 'CANCION nandu'), ['Ñandú Jr|Canción']);
  } finally {
    await cleanup();
  }
});

test('sin etiquetas, el título del nombre del archivo y la carpeta como artista siguen la misma regla', async () => {
  const { root, cleanup } = await makeMusicDir();
  try {
    const library = await openLibrary(root, { readTags: async () => { throw new Error('sin etiquetas'); } });

    // «Canción A» (9 caracteres) sale de «Artista Uno - Canción A.mp3»; el nombre de archivo no cuenta como largo.
    assert.deepEqual(strictIds(library, 'cancion'), []);
    assert.deepEqual(strictIds(library, 'cancion artista'), ['Artista Uno|Canción A']);
    // «Tema Ñandú» tiene 10 caracteres.
    assert.deepEqual(strictIds(library, 'tema nandu'), ['Banda|Tema Ñandú']);
  } finally {
    await cleanup();
  }
});
