import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';

export const LOCALES = ['es', 'en'];
const DEFAULT_LOCALE = 'es';
const LOCALES_DIR = new URL('../../public/locales/', import.meta.url);

// Textos originales de cada idioma, tal como están en `public/locales/`.
export async function loadLocales() {
  const locales = {};
  for (const locale of LOCALES) {
    const file = fileURLToPath(new URL(`${locale}.json`, LOCALES_DIR));
    locales[locale] = JSON.parse(await readFile(file, 'utf8'));
  }
  return locales;
}

// Devuelve `t(clave, params)`. Con `messages` (ver `Messages`) usa los textos personalizados y devuelve
// null en los mensajes desactivados, para que el bot se calle en lugar de responder.
export async function createTranslator(language = DEFAULT_LOCALE, { locales = null, messages = null } = {}) {
  const resources = {};
  for (const [locale, translation] of Object.entries(locales ?? await loadLocales())) {
    resources[locale] = { translation };
  }

  const instance = i18next.createInstance();
  await instance.init({
    lng: LOCALES.includes(language) ? language : DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    resources,
    interpolation: { escapeValue: false },
  });

  if (messages) {
    const apply = () => {
      for (const locale of LOCALES) {
        for (const leaf of messages.leaves()) instance.addResource(locale, 'translation', leaf, messages.text(locale, leaf));
      }
    };
    apply();
    messages.on('change', apply);
  }

  return (key, params) => (messages && !messages.isEnabled(key) ? null : instance.t(key, params));
}
