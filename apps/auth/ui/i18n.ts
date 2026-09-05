// The login page's own copy of the auth namespace.
//
// `apps/auth` may not import from the panel: it is a separate service on a
// separate origin, and a protected project must work whether or not the panel
// is even installed. These two files are the same strings the panel ships in
// apps/web/messages/*/auth.json, kept in step by hand.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './messages/en.json' with { type: 'json' }
import ptBR from './messages/pt-BR.json' with { type: 'json' }

export function initializeAuthI18n(locale: 'en' | 'pt-BR') {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: locale,
      fallbackLng: 'en',
      resources: { en: { auth: en }, 'pt-BR': { auth: ptBR } },
      defaultNS: 'auth',
      interpolation: { escapeValue: false },
    })
  } else void i18n.changeLanguage(locale)
  return i18n
}
