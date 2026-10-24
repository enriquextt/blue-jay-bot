import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';

const LOCALES = ['es', 'en'];
const DEFAULT_LOCALE = 'es';
const LOCALES_DIR = new URL('../../public/locales/', import.meta.url);

export async function createTranslator(language = DEFAULT_LOCALE) {
  const resources = {};
  for (const locale of LOCALES) {
    const file = fileURLToPath(new URL(`${locale}.json`, LOCALES_DIR));
    resources[locale] = { translation: JSON.parse(await readFile(file, 'utf8')) };
  }

  const instance = i18next.createInstance();
  await instance.init({
    lng: LOCALES.includes(language) ? language : DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    resources,
    interpolation: { escapeValue: false },
  });
  return (key, params) => instance.t(key, params);
}
