import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlaylistVideos, fetchVideoTitle, parsePlaylistId, parseVideoId, searchVideoId } from '../server/youtube/youtube.js';

const ID = 'dQw4w9WgXcQ';

test('acepta un ID de 11 caracteres tal cual', () => {
  assert.equal(parseVideoId(ID), ID);
});

test('extrae el ID de las formas habituales de enlace', () => {
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}&t=42`), ID);
  assert.equal(parseVideoId(`https://youtu.be/${ID}?si=abc`), ID);
  assert.equal(parseVideoId(`https://m.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/embed/${ID}`), ID);
});

test('rechaza hosts ajenos a YouTube aunque contengan el patrón', () => {
  assert.equal(parseVideoId(`https://evil.example/watch?v=${ID}`), null);
  assert.equal(parseVideoId(`https://youtube.com.evil.example/watch?v=${ID}`), null);
});

test('rechaza esquemas que no son http o https', () => {
  assert.equal(parseVideoId(`javascript:alert(${ID})`), null);
  assert.equal(parseVideoId(`file:///watch?v=${ID}`), null);
});

test('rechaza IDs con longitud o caracteres no válidos', () => {
  assert.equal(parseVideoId('corto'), null);
  assert.equal(parseVideoId('demasiado-largo-para-id'), null);
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}<script>`), null);
  assert.equal(parseVideoId(''), null);
  assert.equal(parseVideoId(undefined), null);
});

test('fetchVideoTitle devuelve el título de oEmbed', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ title: 'Mi canción' }));
  assert.equal(await fetchVideoTitle(ID, fakeFetch), 'Mi canción');
});

test('fetchVideoTitle devuelve null si la respuesta no es correcta', async () => {
  const fakeFetch = async () => new Response('', { status: 404 });
  assert.equal(await fetchVideoTitle(ID, fakeFetch), null);
});

test('fetchVideoTitle devuelve null si la red falla', async () => {
  const fakeFetch = async () => {
    throw new Error('sin red');
  };
  assert.equal(await fetchVideoTitle(ID, fakeFetch), null);
});

test('searchVideoId devuelve el ID del primer resultado y envía la clave y los filtros', async () => {
  let requested;
  const fetchImpl = async (url) => {
    requested = new URL(url);
    return { ok: true, json: async () => ({ items: [{ id: { videoId: 'dQw4w9WgXcQ' } }] }) };
  };

  assert.equal(await searchVideoId('never gonna', 'CLAVE', fetchImpl), 'dQw4w9WgXcQ');
  assert.equal(requested.searchParams.get('q'), 'never gonna');
  assert.equal(requested.searchParams.get('key'), 'CLAVE');
  assert.equal(requested.searchParams.get('videoEmbeddable'), 'true');
});

test('searchVideoId devuelve null sin resultados y lanza si la API falla', async () => {
  const empty = async () => ({ ok: true, json: async () => ({ items: [] }) });
  assert.equal(await searchVideoId('nada', 'CLAVE', empty), null);

  const quota = async () => ({ ok: false, status: 403 });
  await assert.rejects(searchVideoId('algo', 'CLAVE', quota), /403/);
});

const PLAYLIST = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';

test('parsePlaylistId acepta URL de playlist e ID suelto, y trata como vídeo la URL con v', () => {
  assert.equal(parsePlaylistId(`https://www.youtube.com/playlist?list=${PLAYLIST}`), PLAYLIST);
  assert.equal(parsePlaylistId(PLAYLIST), PLAYLIST);
  assert.equal(parsePlaylistId(`https://www.youtube.com/watch?v=${ID}&list=${PLAYLIST}`), null);
  assert.equal(parsePlaylistId(`https://example.com/playlist?list=${PLAYLIST}`), null);
  assert.equal(parsePlaylistId(ID), null);
  assert.equal(parsePlaylistId('hola'), null);
});

test('fetchPlaylistVideos recorre las páginas y descarta vídeos privados o eliminados', async () => {
  const pages = {
    primera: {
      nextPageToken: 'SIGUE',
      items: [
        { snippet: { title: 'Uno', resourceId: { videoId: 'aqz-KE-bpKQ' } } },
        { snippet: { title: 'Private video', resourceId: { videoId: 'jNQXAC9IVRw' } } },
      ],
    },
    SIGUE: {
      items: [
        { snippet: { title: 'Dos', resourceId: { videoId: ID } } },
        { snippet: { title: 'Id roto', resourceId: { videoId: 'corto' } } },
      ],
    },
  };
  const requested = [];
  const fetchImpl = async (url) => {
    const params = new URL(url).searchParams;
    requested.push(params);
    return { ok: true, json: async () => pages[params.get('pageToken') ?? 'primera'] };
  };

  const videos = await fetchPlaylistVideos(PLAYLIST, 'CLAVE', fetchImpl);
  assert.deepEqual(videos, [{ videoId: 'aqz-KE-bpKQ', title: 'Uno' }, { videoId: ID, title: 'Dos' }]);
  assert.equal(requested.length, 2);
  assert.equal(requested[0].get('playlistId'), PLAYLIST);
  assert.equal(requested[0].get('key'), 'CLAVE');
});

test('fetchPlaylistVideos lanza si la API falla', async () => {
  await assert.rejects(fetchPlaylistVideos(PLAYLIST, 'CLAVE', async () => ({ ok: false, status: 404 })), /404/);
});
