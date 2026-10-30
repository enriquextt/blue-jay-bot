const LOCALES = ['es', 'en'];
const DEFAULT_LOCALE = 'es';
const STORAGE_KEY = 'blueJay.locale';

function savedLocale() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function saveLocale(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Sin almacenamiento disponible: el idioma solo dura esta sesión.
  }
}

function applyTranslations() {
  document.documentElement.lang = i18next.language;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = i18next.t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = i18next.t(element.dataset.i18nPlaceholder);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', i18next.t(element.dataset.i18nAriaLabel));
  }
}

// `locale` fuerza un idioma (el widget de OBS lo recibe en la dirección); sin él se usa el guardado del panel.
export async function initI18n(locale) {
  const resources = {};
  await Promise.all(LOCALES.map(async (locale) => {
    const response = await fetch(`/locales/${locale}.json`);
    resources[locale] = { translation: await response.json() };
  }));

  await i18next.init({ lng: LOCALES.includes(locale) ? locale : savedLocale(), fallbackLng: DEFAULT_LOCALE, resources });
  applyTranslations();
}

export function currentLocale() {
  return i18next.language;
}

export function setLocale(locale) {
  saveLocale(locale);
  i18next.changeLanguage(locale).then(() => {
    applyTranslations();
    window.dispatchEvent(new Event('localechange'));
  });
}

export function t(key, params) {
  return i18next.t(key, params);
}
