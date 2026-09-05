# Agent index

Rules live next to the work they govern. This file is an index and a set of
repository-wide operating rules, not a second copy of the documentation.

* [Safe operating rules](docs/agent-guidelines.md) — what an agent must never do on a shared development host
* [Monorepo layout](docs/monorepo.md) — where new code goes, workspace boundaries, and how to add a command
* [Shell scripts](docs/scripts.md) — what may still be Bash, and why a new script probably should not be
* [Testing](docs/testing.md) — testing layers, ownership, costs, and release validation
* [Architecture decisions](docs/adr/) — decisions that are expensive to reverse
* [Documentation index](docs/README.md)

Per-directory `AGENTS.md` files are added only when a workspace has rules that
are not true of the rest of the repository.

---

## Testing policy for agents

The default testing strategy in Portta is **targeted validation**, not full
regression.

> **Run the smallest test or check that can reasonably prove the change you
> made. Do not run broader suites merely because an implementation step is
> finished.**

Development speed matters. A broader test suite is not automatically a better
validation if most of the tests cannot be affected by the change.

### The three validation levels

#### 1. While implementing — targeted only

This is the default for ordinary development.

After a coherent implementation step, run only:

1. the test file or test case that directly covers the changed behavior;
2. tests added or modified by the change;
3. a narrowly related test only when there is a concrete reason it may also be
   affected.

Prefer a test file, filename filter, project filter, or `-t` expression over a
whole workspace.

Do **not** run a test after every edited file. Finish a coherent change, then
validate it once.

Examples:

```bash
npm test --workspace=portta-server -- apply
npm test --workspace=portta-server -- -t 'refuses invalid configuration'

npm test --workspace=portta-web -- --project ui settings
npm test --workspace=portta-web -- --project server apply

npm test --workspace=portta-core -- environment
npm test --workspace=portta-contracts -- route
```

When a shell command or script has a dedicated test, run that test directly:

```bash
bash tests/unit/apply.test.sh
bash tests/unit/doctor.test.sh
bash tests/unit/templates.test.sh
```

Do not replace a specific test with `./tests/run.sh`, root `npm test`, or a
workspace-wide suite simply because the narrower command is less familiar.

---

#### 2. Finishing an ordinary task — affected scope only

Completing a task, fix, refactor, UI adjustment, or small feature does **not**
by itself justify running the complete Portta test suite.

Before considering an ordinary task complete:

* run the targeted tests for the changed behavior;
* widen to the owning workspace only when the change genuinely affects several
  files/modules inside that workspace;
* run a relevant contract/schema/boundary check when the change crosses such a
  boundary;
* stop once the affected scope has been validated successfully.

Do **not** automatically run:

```bash
./tests/run.sh
npm test
npm test --workspaces
./tests/run.sh --e2e
./tests/run.sh --all
```

for an ordinary implementation.

The fact that an agent is about to return control to the user is **not** a
reason to run the full suite.

The fact that a feature increment has been completed is **not** a reason by
itself to run the full suite.

If the user explicitly says that they will perform the comprehensive
regression manually later, respect that instruction and do not run it.

---

#### 3. Integration, merge and release — broad regression

Full regression belongs primarily to integration milestones.

`./tests/run.sh` is appropriate when:

* explicitly requested by the user;
* preparing a meaningful branch for merge;
* validating a release candidate;
* changing the test infrastructure or test runner itself;
* making a structural repository-wide change whose blast radius cannot be
  validated reliably with affected suites.

Before a release, use the release validation required by
[docs/testing.md](docs/testing.md), including E2E where appropriate.

Do not silently turn a normal coding task into release validation.

If broad regression would be valuable but was not requested during ordinary
development, report that recommendation at the end instead of automatically
spending the time running it.

---

## Choosing the test scope

Use this table as the **maximum default scope**, not the minimum.

Try to narrow further to a specific test file or test name whenever possible.

| Changed area                                                   | Default validation                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core/src/**`                                         | matching `portta-core` test file/name                                                        |
| `packages/contracts/src/**`                                    | matching `portta-contracts` test + `openapi:check` only when the contract/OpenAPI can change |
| `packages/db/src/schema/**`                                    | matching `portta-db` test + `db:check` when schema/migrations change                         |
| `packages/auth/src/**`                                         | matching `portta-auth-core` test                                                             |
| `packages/server/src/**`                                       | matching `portta-server` test file/name                                                      |
| `packages/cli/src/**`                                          | matching `portta` CLI test                                                                   |
| `apps/auth/src/**`                                             | matching `portta-auth` test                                                                  |
| `apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**` | matching `portta-web --project ui` test                                                      |
| `apps/web/server/**`                                           | matching `portta-web --project server` test                                                  |
| `apps/web/lib/docs/**`                                         | matching `portta-web --project docs` test                                                    |
| API contract/schema change                                     | relevant test + `npm run openapi:check --workspace=portta-contracts`                         |
| `scripts/**`, `bin/portta`, `install.sh`                       | matching `tests/unit/<subject>.test.sh`                                                      |
| Compose/profile change                                         | only the affected profile/template test first                                                |
| documentation-only change                                      | no application test unless generated/validated behavior is affected                          |
| copy, labels or purely visual changes                          | no backend/full-suite regression unless behavior changed                                     |

A whole workspace suite is the fallback when no trustworthy narrower test
exists or when the implementation affects enough of that workspace that
individual selection would miss realistic regressions.

---

## Expensive tests

End-to-end, Playwright, Docker-backed browser tests, full Compose matrices,
viewport checks, installer/lifecycle scenarios and other expensive integration
tests are **not routine development checks**.

Run them when the behavior they exercise was materially changed or at the
integration/release milestone defined in the testing documentation.

Do not run Playwright merely because frontend code changed.

Do not run all E2E tests merely because one API route changed.

Do not rebuild and retest an entire environment when a unit/integration test can
prove the changed rule.

When only one E2E scenario is relevant and the tooling supports it, run that
scenario instead of the complete E2E suite.

---

## Avoid redundant executions

Tests consume development time as well as compute and agent context.

Therefore:

* do not rerun a passing test when no relevant code changed afterward;
* do not run the same test through multiple umbrella commands;
* do not run both a targeted suite and then the complete suite without a
  concrete reason;
* do not repeatedly rerun an environment-related failure without changing
  something that could affect the result;
* do not run tests unrelated to the diff “just to be safe”;
* do not use root `npm test` as a convenient substitute for selecting the
  affected workspace;
* do not execute release validation during every conversational handoff.

If a test fails because of an apparently unrelated pre-existing or environment
problem, investigate enough to identify that fact and report it. Do not expand
the test scope automatically.

---

## Type checking, builds and generated artifacts

Apply the same affected-scope principle to other expensive checks.

Do not automatically perform a repository-wide:

```bash
npm run typecheck
npm run build
```

after every TypeScript edit.

Use a workspace-scoped check when compilation/type safety is relevant to the
change.

A complete build is appropriate when the change affects build behavior,
packaging, framework/build configuration, generated output, or an integration
milestone requires it.

Run OpenAPI/schema/generated-file checks only when the source that generates or
defines those artifacts may have changed.

---

## Shared and structural code

Changes to shared packages such as `packages/core`, contracts, database schema,
workspace boundaries, Compose foundations or other cross-cutting infrastructure
deserve more care, but “shared” does not automatically mean “run everything”.

First identify actual downstream consumers and validate the affected boundary.

Escalate to broader regression only when the blast radius is genuinely broad or
cannot be determined reliably.

---

## Reporting validation

When finishing a task, report which validation was executed.

For example:

```text
Validation:
- portta-server: apply.test.ts
- portta-contracts: openapi:check

Full regression was not run; this change did not require release-level
validation.
```

This is preferable to spending several minutes proving unrelated parts of the
repository after every small change.

---

## Important precedence

The objective of the testing documentation is correctness **and fast feedback**.

If another repository document can be interpreted as requiring
`./tests/run.sh`, all workspace tests, E2E or Playwright after every ordinary
feature or handoff, that interpretation is incorrect.

For agent-driven development, this section governs the default behavior:

> **targeted while developing → affected scope when finishing the task →
> full regression at integration/release milestones.**

See [docs/testing.md](docs/testing.md) for the detailed test architecture and
release procedures.
