import { ASSET_ID } from './catalog.js';

// Fuentes que vienen con el proyecto (archivos con licencia OFL en `public/fonts/`, cada una con su LICENSE) más la del
// sistema. Se sirven desde aquí, no de internet, para que el widget funcione sin conexión. `variable` indica que el
// archivo cubre todos los grosores; el resto solo trae el normal. Solo llevan el subconjunto latino: lo que no cubran
// (japonés, cirílico…) lo resuelve el navegador con otra fuente del sistema.
export const SYSTEM_FONT = 'system';

export const FONTS = {
  system: { label: 'Sistema', stack: 'system-ui, sans-serif' },
  inter: { label: 'Inter', family: 'BJ Inter', file: 'inter/inter.woff2', variable: true, stack: "'BJ Inter', system-ui, sans-serif" },
  montserrat: { label: 'Montserrat', family: 'BJ Montserrat', file: 'montserrat/montserrat.woff2', variable: true, stack: "'BJ Montserrat', system-ui, sans-serif" },
  oswald: { label: 'Oswald', family: 'BJ Oswald', file: 'oswald/oswald.woff2', variable: true, stack: "'BJ Oswald', Impact, sans-serif" },
  'playfair-display': { label: 'Playfair Display', family: 'BJ Playfair Display', file: 'playfair-display/playfair-display.woff2', variable: true, stack: "'BJ Playfair Display', Georgia, serif" },
  'jetbrains-mono': { label: 'JetBrains Mono', family: 'BJ JetBrains Mono', file: 'jetbrains-mono/jetbrains-mono.woff2', variable: true, stack: "'BJ JetBrains Mono', ui-monospace, monospace" },
  'bebas-neue': { label: 'Bebas Neue', family: 'BJ Bebas Neue', file: 'bebas-neue/bebas-neue.woff2', variable: false, stack: "'BJ Bebas Neue', Impact, sans-serif" },
  pacifico: { label: 'Pacifico', family: 'BJ Pacifico', file: 'pacifico/pacifico.woff2', variable: false, stack: "'BJ Pacifico', cursive" },
  'press-start-2p': { label: 'Press Start 2P', family: 'BJ Press Start 2P', file: 'press-start-2p/press-start-2p.woff2', variable: false, stack: "'BJ Press Start 2P', monospace" },
};

export const FONT_KEYS = Object.keys(FONTS);

// El nombre con el que se registra una fuente subida por el usuario.
export const assetFamily = (id) => `bj-asset-${id}`;

export const isAssetFont = (value) => typeof value === 'string' && ASSET_ID.test(value);

// Lista de familias de CSS para el valor de `fontFamily` de un texto: una clave del catálogo o el id de una fuente subida.
export function fontStack(value) {
  if (Object.hasOwn(FONTS, value)) return FONTS[value].stack;
  if (isAssetFont(value)) return `"${assetFamily(value)}", ${FONTS.system.stack}`;
  return FONTS.system.stack;
}
