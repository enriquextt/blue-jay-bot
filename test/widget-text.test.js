import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/app.js';
import { openDatabase } from '../server/db/database.js';
import { createKv } from '../server/db/kv.js';
import { ASSET_LIMITS, WidgetAssets, detectAsset } from '../server/widget/assets.js';
import { normalizeLayout, usedAssets } from '../server/widget/layout.js';
import { WidgetLayouts } from '../server/widget/layouts.js';
import { FONTS, FONT_KEYS, fontStack } from '../public/js/widget/fonts.js';

const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.from('datos de fuente')]);
const TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('ttf')]);
const OTF = Buffer.concat([Buffer.from('OTTO'), Buffer.from('otf')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen')]);

const text = (extra = {}) => ({ id: 't', type: 'text', x: 0, y: 0, width: 100, height: 20, ...extra });
const layout = (elements) => ({ name: 'Mío', canvas: { width: 400, height: 100 }, elements });
const STOPS = [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }];
const normalize = (extra, options) => normalizeLayout(layout([text(extra)]), options)?.elements[0] ?? null;

test('un texto sin los campos nuevos toma los valores por defecto', () => {
  const clean = normalize({});

  assert.deepEqual(
    [clean.fontFamily, clean.italic, clean.uppercase, clean.lineHeight, clean.letterSpacing, clean.overflow, clean.gradient],
    ['system', false, false, 1.3, 0, 'clamp', null],
  );
  assert.deepEqual(clean.outline, { width: 0, color: '#000000' });
  assert.deepEqual(clean.shadow, { enabled: false, x: 0, y: 2, blur: 4, color: '#000000b3' });
});

test('el texto acepta fuentes del catálogo, estilo, degradado, contorno y sombra', () => {
  const clean = normalize({
    fontFamily: 'bebas-neue',
    italic: true,
    uppercase: true,
    lineHeight: 1,
    letterSpacing: 2.5,
    overflow: 'marquee',
    gradient: { angle: 45, stops: STOPS, evil: 1 },
    outline: { width: 3, color: '#112233', css: 'x' },
    shadow: { enabled: true, x: 1, y: 2, blur: 3, color: '#00000080' },
  });

  assert.equal(clean.fontFamily, 'bebas-neue');
  assert.deepEqual(clean.gradient, { angle: 45, stops: STOPS });
  assert.deepEqual(clean.outline, { width: 3, color: '#112233' });
  assert.equal(clean.overflow, 'marquee');
  assert.equal(normalize({ gradient: null }).gradient, null);
  for (const key of FONT_KEYS) assert.ok(normalize({ fontFamily: key }), key);
});

test('el texto rechaza nombres de fuente libres y valores fuera de rango', () => {
  const invalid = [
    { fontFamily: 'Arial' },
    { fontFamily: "Arial; background: url('x')" },
    { fontFamily: '__proto__' },
    { fontFamily: 'A'.repeat(32) },
    { fontFamily: 5 },
    { italic: 'sí' },
    { uppercase: 1 },
    { lineHeight: 0.5 },
    { lineHeight: 4 },
    { letterSpacing: 100 },
    { overflow: 'scroll' },
    { gradient: { angle: 0, stops: [STOPS[0]] } },
    { gradient: 'rojo' },
    { outline: { width: 21 } },
    { outline: { color: 'red' } },
    { outline: 'negro' },
    { shadow: { blur: 101 } },
    { shadow: { enabled: 'sí' } },
  ];
  for (const extra of invalid) assert.equal(normalize(extra), null, JSON.stringify(extra));
});

test('una fuente subida se acepta si existe y es una fuente; una imagen no sirve como fuente', () => {
  const font = 'a'.repeat(32);
  const known = { [font]: 'font', ['b'.repeat(32)]: 'image' };
  const hasAsset = (id, kind) => known[id] !== undefined && (kind === undefined || kind === null || known[id] === kind);

  assert.equal(normalize({ fontFamily: font }, { hasAsset })?.fontFamily, font);
  assert.equal(normalize({ fontFamily: 'b'.repeat(32) }, { hasAsset }), null);
  assert.equal(normalize({ fontFamily: 'c'.repeat(32) }, { hasAsset }), null);
  // Sin comprobador (al cargar lo guardado) vale cualquier id con el formato correcto.
  assert.ok(normalize({ fontFamily: 'c'.repeat(32) }));

  assert.deepEqual(usedAssets(normalizeLayout(layout([text({ fontFamily: font }), text({ id: 'u', fontFamily: 'inter' })]))), [font]);
});

test('fontStack da una lista de familias del catálogo, de una fuente subida o la del sistema', () => {
  assert.equal(fontStack('system'), 'system-ui, sans-serif');
  assert.match(fontStack('inter'), /^'BJ Inter', /);
  assert.equal(fontStack('a'.repeat(32)), '"bj-asset-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", system-ui, sans-serif');
  // Nada que no sea del catálogo o un id llega a CSS.
  assert.equal(fontStack("x'; color: red"), 'system-ui, sans-serif');
  assert.equal(fontStack(undefined), 'system-ui, sans-serif');
});

test('las fuentes empaquetadas existen en disco, con su licencia, y están declaradas en fonts.css', async () => {
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const css = await readFile(join(root, 'css', 'fonts.css'), 'utf8');

  for (const [key, font] of Object.entries(FONTS)) {
    if (!font.file) continue;
    const folder = font.file.split('/')[0];
    assert.deepEqual((await readdir(join(root, 'fonts', folder))).sort(), ['LICENSE.txt', `${folder}.woff2`], key);
    assert.equal((await readFile(join(root, 'fonts', font.file))).subarray(0, 4).toString('latin1'), 'wOF2', key);
    assert.match(await readFile(join(root, 'fonts', folder, 'LICENSE.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i, key);
    assert.ok(css.includes(`font-family: '${font.family}'`) && css.includes(`url('/fonts/${font.file}')`), key);
  }
});

test('detectAsset reconoce WOFF2, TTF y OTF por sus bytes', () => {
  assert.equal(detectAsset(WOFF2).type, 'font/woff2');
  assert.equal(detectAsset(TTF).type, 'font/ttf');
  assert.equal(detectAsset(OTF).type, 'font/otf');
  assert.equal(detectAsset(Buffer.from('<html>')), null);
  assert.equal(detectAsset(Buffer.from('wOFF datos')), null);
});

test('las fuentes tienen su propio límite de tamaño y se distinguen de las imágenes', async () => {
  const kv = createKv(openDatabase());
  const assets = new WidgetAssets({ kv });
  const font = await assets.add(WOFF2, 'Mi fuente.woff2');
  const image = await assets.add(PNG, 'logo.png');

  assert.equal(font.type, 'font/woff2');
  assert.deepEqual([assets.has(font.id), assets.has(font.id, 'font'), assets.has(font.id, 'image')], [true, true, false]);
  assert.deepEqual([assets.has(image.id, 'image'), assets.has(image.id, 'font')], [true, false]);

  // Un archivo de 1 MB cabe como imagen, pero no como fuente.
  const padding = Buffer.alloc(ASSET_LIMITS.fontBytes);
  await assert.rejects(assets.add(Buffer.concat([WOFF2, padding])), (error) => error.code === 'tooLarge');
  assert.ok(await assets.add(Buffer.concat([PNG, padding])));
});

test('los layouts solo guardan fuentes subidas que existen y no dejan borrar la que usan', async () => {
  const kv = createKv(openDatabase());
  const assets = new WidgetAssets({ kv });
  const layouts = new WidgetLayouts({ kv, assets });
  const font = await assets.add(WOFF2, 'a.woff2');
  const image = await assets.add(PNG, 'a.png');

  assert.equal(layouts.save(layout([text({ fontFamily: 'e'.repeat(32) })])), null);
  assert.equal(layouts.save(layout([text({ fontFamily: image.id })])), null);

  const saved = layouts.save(layout([text({ fontFamily: font.id })]));
  assert.ok(saved);
  assert.deepEqual([...layouts.usedAssets()], [font.id]);
  layouts.remove(saved.id);
  assert.deepEqual([...layouts.usedAssets()], []);
});

test('POST /api/widget/assets acepta fuentes con su tipo y las sirve como tales', async () => {
  const server = await createServer({ host: '127.0.0.1', port: 0 });
  const { port } = server.app.server.address();
  const http = `http://127.0.0.1:${port}`;
  const post = (body, type) => fetch(`${http}/api/widget/assets`, { method: 'POST', headers: { 'Content-Type': type }, body });
  try {
    for (const [body, type] of [[WOFF2, 'font/woff2'], [TTF, 'font/ttf'], [OTF, 'font/otf']]) {
      const response = await post(body, type);
      assert.equal(response.status, 200, type);
      const saved = await response.json();
      assert.equal(saved.type, type);

      const served = await fetch(`${http}/widget-assets/${saved.id}`);
      assert.equal(served.headers.get('content-type'), type);
      assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(Buffer.from(await served.arrayBuffer()).equals(body), true);
    }

    // Lo que dice la cabecera no cuenta: unos bytes de imagen enviados como fuente se guardan como imagen.
    assert.equal((await (await post(PNG, 'font/woff2')).json()).type, 'image/png');
    assert.equal((await post(Buffer.from('no soy una fuente'), 'font/ttf')).status, 400);
    assert.equal((await post(Buffer.concat([WOFF2, Buffer.alloc(ASSET_LIMITS.fontBytes)]), 'font/woff2')).status, 413);
    assert.equal((await post(WOFF2, 'application/octet-stream')).status, 415);
  } finally {
    await server.close();
  }
});
