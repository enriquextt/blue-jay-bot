#!/usr/bin/env node
// Muestra las etiquetas ID3 actuales de cada .mp3 de una carpeta y marca los campos vacíos.
// Uso: node tools/fill-id3.mjs [carpeta] [--json]
import { readdir } from 'fs/promises';
import { extname, join } from 'path';
import { readTags } from './id3-common.mjs';

const REPORT_FIELDS = ['title', 'artist', 'album', 'subtitle', 'comment', 'description'];

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--')) || 'localLibrary/enRevision';
  const asJson = args.includes('--json');

  const files = (await readdir(dir)).filter(f => extname(f).toLowerCase() === '.mp3').sort();
  const report = files.map(f => {
    const tags = readTags(join(dir, f));
    const missing = REPORT_FIELDS.filter(k => !tags[k]);
    return { file: f, tags, missing };
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (files.length === 0) {
    console.log(`No hay archivos .mp3 en ${dir}`);
    return;
  }
  for (const { file, tags, missing } of report) {
    console.log(`\n${file}`);
    for (const [k, v] of Object.entries(tags)) {
      if (v !== undefined && v !== '') console.log(`  ${k.padEnd(12)} ${v}`);
    }
    console.log(`  ${'FALTAN'.padEnd(12)} ${missing.length ? missing.join(', ') : '(ninguno)'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
