import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
import { Shortcut, useModKey } from '@/components/ui/kbd'
import { ThemeProvider, useDarkTheme, useHydrated, useThemeChoice } from '@/lib/theme'

// What the panel renders on the server and what the browser renders on its
// first pass have to be the same string. When they are not, React throws the
// server's tree away and rebuilds the whole panel in the browser — which is
// what the modifier key and the theme icon each used to do, one on a Mac and
// the other on any machine that had ever chosen a theme.
//
// `renderToString` is the server's answer. `render` is the browser's, one
// render later. Every hook here has to be able to give both.

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

function onMac<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: MAC })
  try {
    return run()
  } finally {
    Object.defineProperty(navigator, 'userAgent', original ?? { configurable: true, value: undefined })
  }
}

function Mod() {
  return <span data-testid="mod">{useModKey()}</span>
}

function Hydrated() {
  return <span data-testid="hydrated">{String(useHydrated())}</span>
}

function Dark() {
  return <span data-testid="dark">{String(useDarkTheme())}</span>
}

function Choice() {
  return <span data-testid="choice">{useThemeChoice().theme}</span>
}

afterEach(() => window.localStorage.clear())

describe('the modifier key', () => {
  it('is Ctrl on the server, on a Mac as much as anywhere', () => {
    onMac(() => {
      expect(renderToString(<Mod />)).toContain('Ctrl')
      expect(renderToString(<Mod />)).not.toContain('⌘')
    })
  })

  it('is the platform key once the browser has it', () => {
    onMac(() => {
      render(<Mod />)
      expect(screen.getByTestId('mod')).toHaveTextContent('⌘')
    })
  })

  it('reaches a shortcut the same way', () => {
    onMac(() => {
      expect(renderToString(<Shortcut keys={['mod', 'k']} />)).toContain('Ctrl')
      render(<Shortcut keys={['mod', 'k']} />)
      expect(screen.getByText('⌘')).toBeInTheDocument()
    })
  })
})

describe('the theme', () => {
  it('is whatever the machine says until the browser has read its storage', () => {
    window.localStorage.setItem('portta-theme', 'dark')
    const tree = (
      <ThemeProvider attribute="class" storageKey="portta-theme">
        <Choice />
      </ThemeProvider>
    )
    expect(renderToString(tree)).toContain('system')
    render(tree)
    expect(screen.getByTestId('choice')).toHaveTextContent('dark')
  })

  it('is light on the server even when the browser will call it dark', () => {
    window.localStorage.setItem('portta-theme', 'dark')
    const tree = (
      <ThemeProvider attribute="class" storageKey="portta-theme">
        <Dark />
      </ThemeProvider>
    )
    expect(renderToString(tree)).toContain('false')
    render(tree)
    expect(screen.getByTestId('dark')).toHaveTextContent('true')
  })
})

describe('hydration itself', () => {
  it('has not happened on the server and has in the browser', () => {
    expect(renderToString(<Hydrated />)).toContain('false')
    render(<Hydrated />)
    expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
  })
})
