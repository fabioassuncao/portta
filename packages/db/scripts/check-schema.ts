// Does the checked-in SQL still describe the schema?
//
// `drizzle-kit check` answers a narrower question — whether the journal and the
// snapshots are consistent with each other — and says nothing about a column
// added to src/schema and never generated. The only way to ask that is to run
// the generator and see whether it wants to write anything.
//
// So this runs it, and fails if a file appeared, deleting the file it caused so
// a failed check leaves the tree exactly as it found it. `npm run db:generate`
// is how you make it pass, and the SQL it writes is reviewed like any code.

import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const drizzleDir = join(packageRoot, 'drizzle')

const sqlFiles = (): string[] => readdirSync(drizzleDir).filter((name) => name.endsWith('.sql')).sort()

function run(...args: string[]): void {
  execFileSync('npx', ['drizzle-kit', ...args], {
    cwd: packageRoot,
    stdio: 'inherit',
    // The schema imports portta-core, which resolves to TypeScript only under
    // this condition; without it drizzle-kit cannot load the schema at all.
    env: { ...process.env, NODE_OPTIONS: '--conditions=development' },
  })
}

const before = sqlFiles()

run('check')
run('generate')

const after = sqlFiles()
const added = after.filter((name) => !before.includes(name))

if (added.length > 0) {
  for (const name of added) rmSync(join(drizzleDir, name))
  // The journal and snapshot the generator also wrote are restored by git; say
  // so, because a half-written drizzle/ is confusing to find on your own.
  process.stderr.write(
    `src/schema has changes no migration describes: ${added.join(', ')}\n` +
      'run: npm run db:generate --workspace=portta-db, review the SQL, and commit it\n' +
      "(this check removed the .sql it just wrote; `git checkout packages/db/drizzle/meta` restores the rest)\n",
  )
  process.exit(1)
}

process.stdout.write(`schema and migrations agree (${after.length} migration${after.length === 1 ? '' : 's'})\n`)
