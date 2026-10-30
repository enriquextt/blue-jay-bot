#!/usr/bin/env node
// Aplica un mapeo { "archivo.mp3": { campos } } a las etiquetas ID3 y verifica la escritura.
// Uso: node tools/apply-tags.mjs <mapping.json> <carpeta> [--dry]
import NodeID3 from 'node-id3';
import { buildTags, FIELDS, loadMapping, readTags, resolveMp3 } from './id3-common.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Uso: node tools/apply-tags.mjs <mapping.json> <carpeta> [--dry]');
    process.exit(1);
  }
  const [mappingPath, dir] = args;
  const dry = args.includes('--dry');

  const mapping = await loadMapping(mappingPath);
  let failures = 0;

  for (const [filename, entry] of Object.entries(mapping)) {
    console.log(`\n${dry ? '[DRY]' : '[WRITE]'} ${filename}`);
    console.log('  ', JSON.stringify(entry));
    if (dry) continue;

    const file = resolveMp3(dir, filename);
    // update() conserva los frames que no están en el mapeo (año, pista, género, carátula).
    const result = NodeID3.update(buildTags(entry), file);
    if (result !== true) {
      console.log('  ERROR de escritura:', result?.message ?? result);
      failures++;
      continue;
    }

    // Verificación: leer de nuevo el archivo y comparar cada campo del mapeo.
    const actual = readTags(file);
    const mismatches = FIELDS.filter(k => k in entry && (actual[k] ?? null) !== entry[k]);
    if (mismatches.length === 0) {
      console.log('  OK (verificado)');
    } else {
      failures++;
      for (const k of mismatches) {
        console.log(`  MISMATCH ${k}: esperado "${entry[k]}", leído "${actual[k] ?? null}"`);
      }
    }
  }

  if (!dry) console.log(failures === 0 ? '\nTodas las etiquetas se aplicaron y verificaron.' : `\n${failures} archivo(s) con errores.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(e => { console.error(e); process.exit(1); });
