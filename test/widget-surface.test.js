import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/app.js';
import { openDatabase } from '../server/db/database.js';
import { createKv } from '../server/db/kv.js';
import { AssetError, ASSET_LIMITS, WidgetAssets, detectImage } from '../server/widget/assets.js';
import { normalizeLayout, usedAssets } from '../server/widget/layout.js';
import { WidgetLayouts } from '../server/widget/layouts.js';
import { SHAPES, SHAPE_TYPES } from '../public/js/widget/catalog.js';
import { linearGradientPoints, shapePath } from '../public/js/widget/shapes.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('datos de una imagen')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg')]);
const GIF = Buffer.from('GIF89a-contenido');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const surface = (extra = {}) => ({ id: 'a', type: 'box', x: 0, y: 0, width: 100, height: 50, ...extra });
const layout = (elements, extra = {}) => ({ name: 'Mío', canvas: { width: 400, height: 100 }, elements, ...extra });
const STOPS = [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff80' }];

test('shapePath devuelve un camino cerrado para cada forma y variante', () => {
  for (const [type, { variants }] of Object.entries(SHAPES)) {
    for (const variant of variants.length > 0 ? variants : [null]) {
      const path = shapePath({ type, radius: 10, variant }, 120, 60);
      assert.match(path, /^M[\d.\- A-Za-z]+Z$/, `${type}/${variant}`);
      assert.equal(path.includes('NaN'), false, `${type}/${variant}`);
    }
  }
  assert.equal(SHAPE_TYPES.length, 8);
});

test('shapePath: triángulos de esquina con el ángulo recto donde toca y rectángulo redondeado acotado', () => {
  assert.equal(shapePath({ type: 'triangle-corner', variant: 'tl' }, 100, 50), 'M0 0L100 0L0 50Z');
  assert.equal(shapePath({ type: 'triangle-corner', variant: 'tr' }, 100, 50), 'M0 0L100 0L100 50Z');
  assert.equal(shapePath({ type: 'triangle-corner', variant: 'bl' }, 100, 50), 'M0 0L0 50L100 50Z');
  assert.equal(shapePath({ type: 'triangle-corner', variant: 'br' }, 100, 50), 'M100 0L100 50L0 50Z');
  assert.equal(shapePath({ type: 'rect', radius: 0 }, 100, 50), 'M0 0L100 0L100 50L0 50Z');
  // Un radio mayor que la mitad del lado se acota: nunca se solapan las esquinas.
  assert.equal(shapePath({ type: 'rect', radius: 999 }, 100, 50), shapePath({ type: 'rect', radius: 25 }, 100, 50));
  assert.equal(shapePath({ type: 'diamond' }, 100, 50), 'M50 0L100 25L50 50L0 25Z');
});

test('linearGradientPoints sigue el ángulo de CSS y llega a las esquinas', () => {
  assert.deepEqual(linearGradientPoints(90, 200, 100), { x1: 0, y1: 50, x2: 200, y2: 50 });
  assert.deepEqual(linearGradientPoints(0, 200, 100), { x1: 100, y1: 100, x2: 100, y2: 0 });
  assert.deepEqual(linearGradientPoints(180, 200, 100), { x1: 100, y1: 0, x2: 100, y2: 100 });

  // A 45° en un cuadrado la recta va de una esquina a la opuesta.
  const diagonal = linearGradientPoints(45, 100, 100);
  assert.deepEqual([diagonal.x1, diagonal.y1, diagonal.x2, diagonal.y2], [0, 100, 100, 0]);
});

test('normalizeLayout completa los valores de una superficie y reconstruye sus partes', () => {
  const clean = normalizeLayout(layout([surface({ shape: { type: 'rect', radius: 4, css: 'x' }, fill: { type: 'solid', color: '#112233', evil: 1 } })]));

  assert.deepEqual(clean.elements[0].shape, { type: 'rect', radius: 4, variant: null });
  assert.deepEqual(clean.elements[0].fill, { type: 'solid', color: '#112233' });
  assert.deepEqual(clean.elements[0].border, { width: 0, color: '#ffffff', style: 'solid' });
  assert.deepEqual(clean.elements[0].shadow, { enabled: false, x: 0, y: 4, blur: 8, color: '#00000080' });

  // Una forma con variantes toma la primera si falta; una sin ellas descarta la que le pongan.
  const semicircle = normalizeLayout(layout([surface({ shape: { type: 'semicircle' } })]));
  assert.equal(semicircle.elements[0].shape.variant, 'top');
  assert.equal(normalizeLayout(layout([surface({ shape: { type: 'hexagon', variant: 'tl' } })])).elements[0].shape.variant, null);
});

test('normalizeLayout acepta degradados e imágenes y rechaza lo que no es del catálogo', () => {
  const linear = normalizeLayout(layout([surface({ fill: { type: 'linear', angle: 45, stops: STOPS } })]));
  assert.deepEqual(linear.elements[0].fill, { type: 'linear', angle: 45, stops: STOPS });
  assert.deepEqual(normalizeLayout(layout([surface({ fill: { type: 'radial', stops: STOPS } })])).elements[0].fill, { type: 'radial', stops: STOPS });
  assert.deepEqual(normalizeLayout(layout([surface({ fill: { type: 'none' } })])).elements[0].fill, { type: 'none' });

  const asset = 'a'.repeat(32);
  const image = normalizeLayout(layout([surface({ type: 'image', fill: { type: 'image', asset, fit: 'contain' } })]));
  assert.deepEqual(image.elements[0].fill, { type: 'image', asset, fit: 'contain' });
  assert.deepEqual(usedAssets(image), [asset]);
  assert.deepEqual(normalizeLayout(layout([surface({ type: 'image' })])).elements[0].fill, { type: 'image', asset: null, fit: 'cover' });

  const invalid = [
    surface({ shape: { type: 'star' } }),
    surface({ shape: { type: 'semicircle', variant: 'diagonal' } }),
    surface({ shape: { type: '__proto__' } }),
    surface({ shape: { type: 'rect', radius: -1 } }),
    surface({ fill: { type: 'pattern' } }),
    surface({ fill: { type: 'linear', stops: [STOPS[0]] } }),
    surface({ fill: { type: 'linear', stops: [...STOPS, ...STOPS, STOPS[0]] } }),
    surface({ fill: { type: 'linear', stops: [STOPS[1], STOPS[0]] } }),
    surface({ fill: { type: 'linear', stops: [{ offset: 0, color: 'red' }, STOPS[1]] } }),
    surface({ fill: { type: 'linear', angle: 400, stops: STOPS } }),
    surface({ fill: { type: 'image', asset: '../../etc/passwd' } }),
    surface({ fill: { type: 'image', asset: 'A'.repeat(32) } }),
    surface({ fill: { type: 'image', asset, fit: 'zoom' } }),
    surface({ border: { width: 51 } }),
    surface({ border: { style: 'dotted' } }),
    surface({ border: 'solid' }),
    surface({ shadow: { blur: -1 } }),
    surface({ shadow: { color: 'url(x)' } }),
    surface({ shadow: { enabled: 'sí' } }),
  ];
  for (const element of invalid) assert.equal(normalizeLayout(layout([element])), null, JSON.stringify(element));
});

test('al guardar se comprueba que las imágenes existen', () => {
  const asset = 'b'.repeat(32);
  const image = (id) => surface({ type: 'image', fill: { type: 'image', asset: id, fit: 'cover' } });

  assert.ok(normalizeLayout(layout([image(asset)])));
  assert.equal(normalizeLayout(layout([image(asset)]), { hasAsset: () => false }), null);
  assert.ok(normalizeLayout(layout([image(asset)]), { hasAsset: (id) => id === asset }));
});

test('detectImage reconoce PNG, JPEG, GIF y WebP por sus bytes y descarta SVG y otros', () => {
  assert.equal(detectImage(PNG).type, 'image/png');
  assert.equal(detectImage(JPEG).type, 'image/jpeg');
  assert.equal(detectImage(GIF).type, 'image/gif');
  assert.equal(detectImage(WEBP).type, 'image/webp');
  for (const buffer of [SVG, Buffer.from('MZ ejecutable'), Buffer.alloc(0), Buffer.from('RIFF....WAVEfmt ')]) {
    assert.equal(detectImage(buffer), null);
  }
});

test('WidgetAssets guarda en memoria o en disco, no repite el mismo contenido y respeta los límites', async () => {
  const kv = createKv(openDatabase());
  const assets = new WidgetAssets({ kv });
  let changes = 0;
  assets.on('change', () => { changes += 1; });

  const first = await assets.add(PNG, 'Mi logo.png');
  assert.match(first.id, /^[0-9a-f]{32}$/);
  assert.deepEqual({ ...first, id: undefined }, { id: undefined, name: 'Mi logo.png', type: 'image/png', size: PNG.length });
  assert.deepEqual(await assets.add(PNG, 'otro nombre'), first);
  assert.equal(changes, 1);
  assert.deepEqual(assets.list(), [first]);
  assert.equal((await assets.read(first.id)).buffer.equals(PNG), true);
  assert.equal(await assets.read('../x'), null);
  assert.equal(await assets.read('c'.repeat(32)), null);

  await assert.rejects(assets.add(SVG, 'x.svg'), (error) => error instanceof AssetError && error.code === 'invalid');
  await assert.rejects(assets.add('texto'), (error) => error.code === 'invalid');
  const big = Buffer.concat([PNG, Buffer.alloc(ASSET_LIMITS.imageBytes)]);
  await assert.rejects(assets.add(big), (error) => error.code === 'tooLarge');

  // El nombre se limpia: sin saltos de línea ni caracteres de control, con tope de longitud y uno por defecto.
  assert.equal((await assets.add(JPEG, '  a\nb\u0000c  ')).name, 'abc');
  assert.equal((await assets.add(GIF, 'x'.repeat(200))).name.length, 60);
  assert.equal((await assets.add(WEBP, '')).name, 'imagen');

  // Tope de cantidad.
  for (let i = assets.list().length; i < ASSET_LIMITS.count; i += 1) await assets.add(Buffer.concat([PNG, Buffer.from(String(i))]));
  await assert.rejects(assets.add(Buffer.concat([PNG, Buffer.from('uno más')])), (error) => error.code === 'limit');

  assert.equal(await assets.remove(first.id), true);
  assert.equal(await assets.remove(first.id), false);
  assert.equal(await assets.read(first.id), null);

  // El índice sobrevive a reabrir y lo dañado se descarta.
  const reopened = new WidgetAssets({ kv });
  assert.equal(reopened.list().length, assets.list().length);
  kv.set('widget.assets', [{ id: 'malo', type: 'image/png', ext: 'png', size: 1, name: 'x' }, { id: 'd'.repeat(32), type: 'text/html', ext: 'html', size: 1, name: 'x' }]);
  assert.deepEqual(new WidgetAssets({ kv }).list(), []);
});

test('WidgetAssets en disco usa el id como nombre de archivo, nunca el que mande el cliente', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bluejay-assets-'));
  try {
    const assets = new WidgetAssets({ kv: createKv(openDatabase()), dir: join(dir, 'imagenes') });
    const saved = await assets.add(PNG, '../../../etc/passwd');

    assert.deepEqual(await readdir(join(dir, 'imagenes')), [`${saved.id}.png`]);
    assert.equal((await assets.read(saved.id)).buffer.equals(PNG), true);
    await assets.remove(saved.id);
    assert.deepEqual(await readdir(join(dir, 'imagenes')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('los layouts guardan solo con imágenes que existen y listan las que usan', async () => {
  const kv = createKv(openDatabase());
  const assets = new WidgetAssets({ kv });
  const layouts = new WidgetLayouts({ kv, assets });
  const { id } = await assets.add(PNG, 'a.png');
  const image = (asset) => surface({ type: 'image', fill: { type: 'image', asset, fit: 'cover' } });

  assert.equal(layouts.save(layout([image('e'.repeat(32))])), null);
  assert.deepEqual([...layouts.usedAssets()], []);

  const saved = layouts.save(layout([image(id)]));
  assert.ok(saved);
  assert.deepEqual([...layouts.usedAssets()], [id]);

  layouts.remove(saved.id);
  assert.deepEqual([...layouts.usedAssets()], []);
});

async function startServer() {
  const server = await createServer({ host: '127.0.0.1', port: 0, fetchTitle: async () => 'Título' });
  const { port } = server.app.server.address();
  return { server, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages = [];
    const waiters = [];
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
      for (const waiter of waiters.splice(0)) waiter();
    });
    socket.on('open', () => resolve({ socket, messages, waitFor }));
    socket.on('error', reject);

    function waitFor(predicate) {
      return new Promise((done) => {
        const check = () => {
          const found = messages.find(predicate);
          if (found) return done(found);
          waiters.push(check);
        };
        check();
      });
    }
  });
}

const upload = (http, body, headers = {}) => fetch(`${http}/api/widget/assets`, { method: 'POST', headers: { 'Content-Type': 'image/png', ...headers }, body });

test('POST /api/widget/assets guarda la imagen, la sirve con cabeceras seguras y avisa a los paneles', async () => {
  const { server, http, ws } = await startServer();
  const panel = await connect(ws);
  try {
    assert.deepEqual((await panel.waitFor((m) => m.type === 'widget.assets')).data, []);

    const response = await upload(http, PNG, { 'X-Filename': encodeURIComponent('Mi logo ñ.png') });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.name, 'Mi logo ñ.png');
    assert.equal(saved.type, 'image/png');
    await panel.waitFor((m) => m.type === 'widget.assets' && m.data.length === 1);

    const served = await fetch(`${http}/widget-assets/${saved.id}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.match(served.headers.get('content-security-policy'), /sandbox/);
    assert.match(served.headers.get('cache-control'), /immutable/);
    assert.equal(Buffer.from(await served.arrayBuffer()).equals(PNG), true);

    for (const bad of ['no-existe', 'f'.repeat(32), '..%2F..%2Fpackage.json']) {
      assert.equal((await fetch(`${http}/widget-assets/${bad}`)).status, 404, bad);
    }
  } finally {
    panel.socket.close();
    await server.close();
  }
});

test('la subida rechaza lo que no es una imagen admitida, lo demasiado grande y otros orígenes', async () => {
  const { server, http } = await startServer();
  try {
    // Aunque diga ser PNG, lo que cuenta son los bytes.
    const fake = await upload(http, SVG);
    assert.equal(fake.status, 400);
    assert.deepEqual(await fake.json(), { error: 'invalid' });

    const svgType = await upload(http, SVG, { 'Content-Type': 'image/svg+xml' });
    assert.equal(svgType.status, 415);

    const big = await upload(http, Buffer.concat([PNG, Buffer.alloc(ASSET_LIMITS.imageBytes)]));
    assert.equal(big.status, 413);

    // Una página de otro sitio no puede subir archivos aunque el navegador estuviera en el propio equipo.
    const foreign = await upload(http, PNG, { Origin: 'https://example.com' });
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { error: 'localOnly' });
  } finally {
    await server.close();
  }
});

test('widget.asset.delete borra una imagen sin uso y se niega si algún layout la usa', async () => {
  const { server, http, ws } = await startServer();
  const panel = await connect(ws);
  try {
    const { id } = await (await upload(http, PNG)).json();
    const errors = () => panel.messages.filter((m) => m.type === 'error').map((m) => m.key);
    const send = (message) => panel.socket.send(JSON.stringify(message));

    send({
      type: 'widget.layout.save',
      layout: layout([surface({ type: 'image', fill: { type: 'image', asset: id, fit: 'cover' } })]),
    });
    const { id: layoutId } = await panel.waitFor((m) => m.type === 'widget.layout.saved');

    send({ type: 'widget.asset.delete', id });
    send({ type: 'widget.asset.delete', id: 'g'.repeat(32) });
    send({ type: 'widget.asset.delete' });
    await panel.waitFor((m) => m.type === 'error' && m.key === 'errors.invalidMessage');
    assert.deepEqual(errors().sort(), ['errors.assetInUse', 'errors.assetNotFound', 'errors.invalidMessage']);

    // Con un layout que usa una imagen inexistente no se guarda.
    send({ type: 'widget.layout.save', layout: layout([surface({ type: 'image', fill: { type: 'image', asset: 'e'.repeat(32), fit: 'cover' } })]) });
    await panel.waitFor((m) => m.type === 'error' && m.key === 'errors.layoutInvalid');

    send({ type: 'widget.layout.delete', id: layoutId });
    send({ type: 'widget.asset.delete', id });
    await panel.waitFor((m) => m.type === 'widget.assets' && m.data.length === 0);
    assert.equal((await fetch(`${http}/widget-assets/${id}`)).status, 404);
  } finally {
    panel.socket.close();
    await server.close();
  }
});
