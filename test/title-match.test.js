import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLocalMatch, searchQueries } from '../server/library/title-match.js';

test('searchQueries quita el ruido de un título de YouTube', () => {
  assert.deepEqual(searchQueries('Rick Astley - Never Gonna Give You Up (Official Music Video)'), ['Rick Astley Never Gonna Give You Up']);
  assert.deepEqual(searchQueries('Queen – Bohemian Rhapsody [Remastered 2011]'), ['Queen Bohemian Rhapsody']);
  assert.deepEqual(searchQueries('Daft Punk - One More Time - Official Video'), ['Daft Punk One More Time']);
  assert.deepEqual(searchQueries('Soda Stereo - De música ligera (Letra) | Canal Oficial'), ['Soda Stereo De música ligera']);
  assert.deepEqual(searchQueries('Artista - Canción - Topic'), ['Artista Canción']);
  assert.deepEqual(searchQueries('Artista - Canción - Lyrics'), ['Artista Canción']);
});

test('searchQueries conserva lo que sí es del nombre y ofrece una variante sin feat.', () => {
  assert.deepEqual(searchQueries('Band - Song (Part 2)'), ['Band Song Part 2']);
  assert.deepEqual(searchQueries('Calle 13 - Atrévete-te-te'), ['Calle 13 Atrévete te te']);
  assert.deepEqual(searchQueries('Dua Lipa - Levitating (feat. DaBaby)'), ['Dua Lipa Levitating feat DaBaby', 'Dua Lipa Levitating']);
  assert.deepEqual(searchQueries('Artista - Tema ft. Invitado'), ['Artista Tema ft Invitado', 'Artista Tema']);
});

test('searchQueries descarta títulos vacíos o demasiado cortos', () => {
  assert.deepEqual(searchQueries(''), []);
  assert.deepEqual(searchQueries(null), []);
  assert.deepEqual(searchQueries('(Official Video)'), []);
  assert.deepEqual(searchQueries('!!'), []);
});

function fakeLibrary(answers, count = 5) {
  const calls = [];
  return {
    calls,
    status: () => ({ count }),
    search(query, options) {
      calls.push({ query, options });
      return { items: answers[query] ? [answers[query]] : [], total: 0 };
    },
  };
}

test('findLocalMatch usa la búsqueda estricta y prueba las variantes en orden', () => {
  const track = { source: 'local', localId: 'a'.repeat(24), title: 'Levitating', artist: 'Dua Lipa' };
  const library = fakeLibrary({ 'Dua Lipa Levitating': track });
  const exclude = () => false;

  const found = findLocalMatch({ library, title: 'Dua Lipa - Levitating (feat. DaBaby)', exclude });
  assert.equal(found, track);
  assert.deepEqual(library.calls.map((call) => call.query), ['Dua Lipa Levitating feat DaBaby', 'Dua Lipa Levitating']);
  assert.ok(library.calls.every((call) => call.options.strict === true && call.options.limit === 1 && call.options.exclude === exclude));
});

test('findLocalMatch devuelve null sin biblioteca, con la biblioteca vacía o sin coincidencia', () => {
  assert.equal(findLocalMatch({ library: null, title: 'Artista - Tema' }), null);
  assert.equal(findLocalMatch({ library: fakeLibrary({}, 0), title: 'Artista - Tema' }), null);

  const library = fakeLibrary({});
  assert.equal(findLocalMatch({ library, title: 'Artista - Tema' }), null);
  assert.equal(findLocalMatch({ library, title: '(Official Video)' }), null);
});
