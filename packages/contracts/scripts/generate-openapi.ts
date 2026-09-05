// The OpenAPI document is generated from the routes and committed beside the
// schemas, so an API change is visible in review. `tests/run.sh` runs this with
// --check; a stale document fails the suite rather than shipping.
//
// This is the one place the contract package reaches for the server, and it is
// a script rather than source: `packages/contracts/src` never imports it, so
// the dependency does not reach anything the browser or the CLI loads.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AppDeps, createApi, generateOpenApi } from 'portta-server'
import { loadConfig } from 'portta-server/config'
import { resolveSecurityMode } from 'portta-auth-core'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repositoryRoot = resolve(packageRoot, '../..')
const output = resolve(packageRoot, 'openapi.json')
const version = readFileSync(resolve(repositoryRoot, 'VERSION'), 'utf8').trim()

// Route registration captures the dependencies but does not call them. The
// generator therefore needs only the real resolved config; no Docker call,
// working tree or network is involved in producing the contract.
// `security` is read while the routes register -- it decides whether Better
// Auth's endpoints are mounted -- so it is the one other thing this needs. Open
// mode, because the document is the same either way: what a route needs does
// not depend on how this panel was started.
const deps = {
  config: loadConfig({ gatewayVersion: version }),
  security: resolveSecurityMode({}),
  auth: null,
} as unknown as AppDeps
const rendered = `${JSON.stringify(await generateOpenApi(createApi(deps), version), null, 2)}\n`

if (process.argv.includes('--check')) {
  const checkedIn = readFileSync(output, 'utf8')
  if (checkedIn !== rendered) {
    process.stderr.write(
      'packages/contracts/openapi.json is stale; run: npm run openapi --workspace=portta-contracts\n',
    )
    process.exitCode = 1
  }
} else {
  writeFileSync(output, rendered, 'utf8')
  process.stdout.write(`wrote ${output}\n`)
}
