import { defineConfig } from 'vitest/config'

// Every suite that touches a row opens its own PGlite and applies the real
// migrations, so what Better Auth writes is checked against the real schema.
export default defineConfig({
  test: {
    name: 'auth-core',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
