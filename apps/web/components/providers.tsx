'use client'

// Everything the tree below needs and the server cannot give it: a query cache,
// a translator, a theme and a place for toasts.
//
// One client boundary, at the top, rather than one per widget. The pages below
// are Server Components; what they render into is this.

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { initI18n } from '@/lib/i18n/client'
import type { Locale } from '@/lib/i18n/resources'
import { ToastProvider } from '@/components/ui/toast'
import { ThemeProvider } from '@/lib/theme'

export function Providers({ children, locale }: { children: ReactNode; locale: Locale }) {
  // One cache per browser session, created in state so React's strict double
  // render does not build two and lose the first one's entries.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Docker events drive the refetching, so the cache does not need to
            // guess: `live.ts` invalidates exactly what an event touched.
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  )
  const [i18n] = useState(() => initI18n(locale))

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          // The panel's own key, so a theme chosen here does not collide with
          // anything else served from the same origin.
          storageKey="portta-theme"
          disableTransitionOnChange
        >
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
}
