'use client'

// The theme, read in a way that survives hydration.
//
// next-themes reads its storage while it initialises, so `useTheme()` answers
// `light` on the very first client render and `undefined` on the server. A
// component that draws an icon from that renders two different icons, React
// calls it a hydration mismatch, and its answer is to throw the server's tree
// away and rebuild the whole panel in the browser.
//
// These hooks give the server's answer while React hydrates and the browser's
// on the render immediately after, so the only cost is a re-render nobody sees.

import { useSyncExternalStore, type ReactNode } from 'react'
import { ThemeProvider as NextThemeProvider, useTheme, type ThemeProviderProps } from 'next-themes'

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

function isTheme(value: string | undefined): value is Theme {
  return value !== undefined && (THEMES as readonly string[]).includes(value)
}

/** Hydration happens once and never unhappens, so nothing has to notify. */
const never = () => () => {}

/** False on the server and while React hydrates; true from then on. */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false)
}

/**
 * The chosen theme and how to change it. `system` until the browser has read
 * its storage, which is also the honest answer for a page nobody has visited.
 */
export function useThemeChoice(): { theme: Theme; setTheme: (value: Theme) => void } {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  return { theme: hydrated && isTheme(theme) ? theme : 'system', setTheme }
}

/** Whether the panel is dark right now. False until the browser has said. */
export function useDarkTheme(): boolean {
  const { resolvedTheme } = useTheme()
  return useHydrated() && resolvedTheme === 'dark'
}

/**
 * The provider itself, re-exported with the prop it takes.
 *
 * next-themes ships props typed against React 18, where `children` came from
 * `PropsWithChildren`. Under React 19's types that is no longer implied, and
 * the component's own declaration does not name it. Naming it here is the
 * narrowest fix: it changes nothing at runtime, and it goes away when the
 * package's types catch up.
 */
export const ThemeProvider = NextThemeProvider as (
  props: ThemeProviderProps & { children: ReactNode },
) => ReactNode
