// Tailwind v4 through PostCSS. The Vite plugin the SPA used has no equivalent
// in a Next build; the PostCSS plugin is the supported path and reads the same
// `@theme` block in app/globals.css.
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
