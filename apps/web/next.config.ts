import type { NextConfig } from 'next'

// The panel is one process: this config describes the Next half of it, and
// `server/main.ts` composes the rest around it. There is no `output:
// 'standalone'` because nothing runs Next on its own.
const config: NextConfig = {
  reactStrictMode: true,
  // Compiled by Next, because client components import them too: they ship
  // TypeScript under the `development` condition and a browser chunk needs it
  // turned into JavaScript.
  transpilePackages: ['portta-core', 'portta-contracts'],
  // Left to Node. These open sockets, read directories beside themselves
  // (`packages/db/drizzle`) and resolve paths from `import.meta.url` — all
  // things a bundler either cannot follow or would rewrite into something that
  // no longer points at the file.
  serverExternalPackages: ['portta-server', 'portta-auth-core', 'portta-db', 'better-auth', '@better-auth/api-key', 'postgres', 'drizzle-orm', '@electric-sql/pglite'],
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The panel can start, stop and remove containers. Nothing may frame
          // it, and nothing may guess at a response's type.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}

export default config
