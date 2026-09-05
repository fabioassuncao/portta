import { defineConfig } from 'vitest/config'

// Every suite here opens its own PGlite and applies the real migrations, so
// they are independent by construction and none of them needs a server.
export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
