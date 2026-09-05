---
version: 1
name: Portta
description: "The design system of the Portta panel: a near-black canvas, a four-step graphite surface ladder, hairline borders, one lavender accent used only for the primary action, focus and selection, and five semantic tones for what containers, tasks and agents are doing. Inter for the interface, JetBrains Mono for anything a terminal would print. Small controls, dense rows, sentence-case labels, no decorative colour and no shadow below a dialog. Light and dark share every token."

principles:
  - "Surface over shadow: hierarchy comes from the surface ladder and hairlines."
  - "One accent, rarely: lavender marks the primary action, focus, selection and a live link."
  - "Colour means something: ok, warn, danger, info and agent are states, never decoration."
  - "Small, dense, aligned: 28px controls, 36px rows, 13px text."
  - "Progressive disclosure: a row shows what a glance needs; the rest is a hover, a menu or a key away."
  - "Keyboard first: ⌘K reaches every place and every action."
  - "The same tokens in both themes; components never know which is active."

colors:
  light:
    bg: "oklch(0.965 0.002 270)"
    surface: "oklch(1 0 0)"
    surface-2: "oklch(0.965 0.003 270)"
    surface-3: "oklch(0.935 0.004 270)"
    surface-4: "oklch(0.905 0.005 270)"
    overlay: "oklch(1 0 0)"
    line-subtle: "oklch(0.93 0.003 270)"
    line: "oklch(0.895 0.004 270)"
    line-strong: "oklch(0.83 0.006 270)"
    ink: "oklch(0.2 0.01 270)"
    muted: "oklch(0.42 0.012 270)"
    subtle: "oklch(0.56 0.012 270)"
    faint: "oklch(0.7 0.01 270)"
    accent: "oklch(0.54 0.17 278)"
    accent-hover: "oklch(0.49 0.18 278)"
    accent-fg: "oklch(0.995 0 0)"
    ok: "oklch(0.6 0.15 152)"
    warn: "oklch(0.66 0.15 68)"
    danger: "oklch(0.58 0.2 24)"
    info: "oklch(0.58 0.13 240)"
    agent: "oklch(0.56 0.17 300)"
    scrim: "oklch(0.2 0.01 270 / 0.4)"
    tooltip: "oklch(0.24 0.01 270)"
  dark:
    bg: "oklch(0.15 0.004 270)"
    surface: "oklch(0.195 0.005 270)"
    surface-2: "oklch(0.23 0.006 270)"
    surface-3: "oklch(0.265 0.007 270)"
    surface-4: "oklch(0.3 0.008 270)"
    overlay: "oklch(0.225 0.006 270)"
    line-subtle: "oklch(0.245 0.006 270)"
    line: "oklch(0.28 0.006 270)"
    line-strong: "oklch(0.36 0.008 270)"
    ink: "oklch(0.96 0.003 270)"
    muted: "oklch(0.8 0.008 270)"
    subtle: "oklch(0.64 0.01 270)"
    faint: "oklch(0.48 0.01 270)"
    accent: "oklch(0.66 0.15 278)"
    accent-hover: "oklch(0.71 0.15 278)"
    accent-fg: "oklch(0.995 0 0)"
    ok: "oklch(0.73 0.15 152)"
    warn: "oklch(0.79 0.15 72)"
    danger: "oklch(0.7 0.18 24)"
    info: "oklch(0.73 0.12 240)"
    agent: "oklch(0.74 0.14 300)"
    scrim: "oklch(0 0 0 / 0.55)"
    tooltip: "oklch(0.3 0.008 270)"
  derived:
    selection: "accent at 10% (light) / 14% (dark)"
    fill: "ink at 6% (light) / 7% (dark) — hover"
    fill-strong: "ink at 11% (light) / 12% (dark) — selected"
    focus: "accent"

typography:
  families:
    sans: "Inter Variable, ui-sans-serif, system-ui"
    mono: "JetBrains Mono Variable, ui-monospace, SF Mono, Menlo"
  scale:
    2xs: { size: 11px, lineHeight: 16px, use: "eyebrows, chips, ids, timestamps" }
    xs: { size: 12px, lineHeight: 18px, use: "metadata, table headers, hints, badges" }
    sm: { size: 13px, lineHeight: 20px, use: "rows, controls, menu items, card bodies" }
    base: { size: 14px, lineHeight: 22px, use: "page body, dialog titles, the command input" }
    lg: { size: 16px, lineHeight: 24px, letterSpacing: -0.01em, use: "page titles" }
    xl: { size: 18px, lineHeight: 24px, letterSpacing: -0.012em, use: "task and project titles" }
    2xl: { size: 22px, lineHeight: 28px, letterSpacing: -0.015em, use: "a number on a stat tile" }
  weights: { text: 400, label: 500, title: 600 }
  mono-for: "paths, ports, URLs, hashes, branches, env keys, commands, ids, logs"

radius:
  xs: 3px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px

spacing:
  unit: 4px
  card-padding: "12px 8px"
  section-gap: 16px
  page-padding: "20px 24px"
  control-height: { xs: 24px, sm: 28px, md: 32px }
  row-height: 36px
  header-height: 36px
  sidebar-width: { expanded: 224px, collapsed: 48px }

elevation:
  card: none
  overlay: "0 4px 16px ink/10, 0 1px 3px ink/6 (light) · 0 6px 20px black/45 (dark)"
  modal: "0 16px 48px ink/18 (light) · 0 20px 56px black/60 (dark)"

motion:
  duration: { hover: 100ms, menu: 140ms, dialog: 160ms, drawer: 180ms }
  easing: "cubic-bezier(0.2, 0, 0, 1)"
  exit: "instant"
  reduced-motion: "everything off"

states:
  hover: "bg-fill on rows and ghost controls; border-line-strong on inputs"
  focus-visible: "2px accent outline, 1px offset"
  active: "one surface step darker than hover"
  selected: "bg-fill-strong text-ink (controls) · bg-selection (rows)"
  checked: "accent fill"
  disabled: "50% opacity"
  invalid: "border-danger with a danger ring"
  read-only: "bg-surface-2"

components:
  button:
    variants: [primary, default, subtle, ghost, outline, danger, link]
    sizes: [xs, sm, md, icon, icon-sm, icon-xs, icon-md]
    radius: md
  badge:
    tones: [neutral, accent, ok, warn, danger, info, agent, outline]
    shapes: [square, pill]
    fill: "tone at 12%, no border"
  status-indicator: "a 6px dot in the tone and a quiet word: ● running"
  input: { height: 32px, sm: 28px, radius: md, border: line, focus: "accent border + 25% ring" }
  card: { radius: lg, border: line, shadow: none, header: 36px }
  menu: { surface: overlay, radius: lg, item: 28px, item-radius: sm, hover: fill }
  popover: { surface: overlay, radius: lg, padding: "12px (panel) / 4px (list)" }
  dialog: { radius: xl, shadow: modal, sizes: [26rem, 34rem, 48rem] }
  drawer: { side: right, widths: [26rem, 40rem, 56rem] }
  tooltip: { surface: tooltip, radius: md, text: xs }
  toast: { surface: overlay, position: bottom-right, icon-per-tone: true }
  tabs: { height: 36px, indicator: "2px accent underline", weight: "500 always" }
  segmented: { height: 28px, selected: "surface with a line ring" }
  table: { header: "12px sentence case subtle", row: "36px, hover fill, selection bg-selection" }
  command-palette: { shortcut: "⌘K", width: 38rem, top: 12vh, item: 32px }
  kbd: { height: 18px, radius: xs, surface: surface-2 }
  sidebar-item: { height: 28px, radius: md, active: "bg-fill-strong text-ink" }
  task-card: { radius: md, border: line, title: "13px/500 with the status icon", chips: "pills, 20px" }
  property-row: { label: "12px subtle, 6.5rem", value: "13px, a quiet button that shows its hover" }

iconography:
  library: lucide-react
  stroke: 1.75
  sizes: { inline: 14px, control: 16px, empty-state: 16px }

layout:
  shell: "sidebar on the canvas · main content as an inset panel with a hairline"
  page: "PageHeader (breadcrumb, title, description, meta, actions) → ViewToolbar (switcher first, then filters, Columns and badges trailing) → content; actions is the page verb, md; ViewToolbar is one row of sm controls in one place, in every view, and never moves into the table; the Overview alone opens with the host's identity (HostHeader) and keeps its title for screen readers"
  detail: "content on the left · a 17rem property column on the right"
  list: "DataTable or rows of 36px; a board is columns of cards on surface-2"

do:
  - "Use StatusIndicator for a state; a badge for a count or a category."
  - "One primary button per page."
  - "Callout for a notice, Field for a labelled control, Mono for a technical value."
  - "Add a token when you need a colour."
  - "Put a view switcher in ViewToolbar, first, as Segmented."
  - "Make a toolbar of ToolbarSearch, ToolbarSelect and ToolbarCheck: 28px, one set of widths."
dont:
  - "Write a hex, an oklch or a Tailwind palette colour in a component."
  - "Use text-[11px]; use text-2xs."
  - "Paint a selected item with the accent tint; use fill-strong."
  - "Add a shadow to a card, or a fourth badge to a row."
  - "Put a view switcher in PageHeader.actions or roll a pair of buttons."
  - "Put a filter in PageHeader.actions, or a toolbar inside the table card."
---

# Portta

The panel is read for hours at a time. Its language is built for that: a
near-black canvas, four graphite surfaces, hairlines, one lavender accent
that appears only where something is actionable, selected or focused, and
five semantic tones that say what a container, a task or an agent is doing.

The tokens above are implemented in `apps/web/src/ui/index.css` and mapped
into Tailwind; the components in `apps/web/src/ui/components/ui/`. The
narrative version, with the reasoning behind each rule, is
[docs/design-system.md](docs/design-system.md).
