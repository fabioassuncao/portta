// The panel's persistence: one connection pool, one migrator, eight
// repositories over it.
//
// The schema and the client are portta-db; the rules are here. Every id crosses
// this boundary as a string and every timestamp as a Date, because that is what
// the services and the routes above have always been written against — the
// database's own `bigint` stays inside.

import {
  appliedMigrations,
  createDb,
  holdsLegacySchema,
  migrateWithLock,
  type Db,
} from 'portta-db'
import { ActivityRepository } from './activity.ts'
import { EnvironmentsRepository } from './environments.ts'
import { GitHubRepository } from './github.ts'
import { ProjectsRepository } from './projects.ts'
import { RepositoriesRepository } from './repositories.ts'
import { SettingsRepository } from './settings.ts'
import { TasksRepository } from './tasks.ts'
import { WorkSessionsRepository } from './work-sessions.ts'

export interface DatabaseStatus {
  configured: boolean
  available: boolean
  reason: string | null
  checkedAt: number | null
  migrations: string[]
}

/** A connection problem, not a schema problem: the caller may retry. */
export class DatabaseUnavailable extends Error {
  readonly status = 503

  constructor(message = 'panel persistence is unavailable') {
    super(message)
    this.name = 'DatabaseUnavailable'
  }
}

/**
 * The volume predates the Drizzle schema. There is no conversion — the old
 * schema was replaced, and the data it held was a projection of Docker, GitHub
 * and the host that rebuilds itself — so the answer is to start from an empty
 * volume rather than to migrate.
 */
export class LegacyDatabase extends Error {
  readonly status = 500

  constructor() {
    super("this volume holds the pre-Drizzle schema; run 'portta reset --yes' and start again")
    this.name = 'LegacyDatabase'
  }
}

/**
 * How a Database reaches the server it is backed by.
 *
 * `Database.open` builds these over postgres-js and the real migrator. A suite
 * builds them over PGlite, which is already migrated when it is handed over —
 * so the migration strategy is a dependency of this class rather than something
 * baked into it, and neither side needs a stand-in for the other.
 */
export interface DatabaseBackend {
  /** Apply pending migrations. Called at boot and by POST /api/database/migrate. */
  migrate: () => Promise<void>
  /** Which migrations this database has, newest last. */
  applied: () => Promise<string[]>
  /** Whether the volume predates the Drizzle schema and needs `portta reset`. */
  legacy: () => Promise<boolean>
  ping: () => Promise<void>
  close: () => Promise<void>
}

export class Database {
  /**
   * The Drizzle handle itself, for Better Auth.
   *
   * Every other consumer goes through a repository, which is what keeps the
   * queries in one place. Better Auth is the exception on purpose: it owns its
   * own tables and issues its own statements through an adapter, so handing it
   * a repository would mean reimplementing the library.
   */
  readonly handle: Db

  readonly environments: EnvironmentsRepository
  readonly projects: ProjectsRepository
  readonly repositories: RepositoriesRepository
  readonly settings: SettingsRepository
  readonly github: GitHubRepository
  readonly tasks: TasksRepository
  readonly sessions: WorkSessionsRepository
  readonly activity: ActivityRepository

  private readonly backend: DatabaseBackend
  private initializing: Promise<void> | null = null
  private state: DatabaseStatus = {
    configured: true,
    available: false,
    reason: 'not checked yet',
    checkedAt: null,
    migrations: [],
  }

  constructor(db: Db, backend: DatabaseBackend) {
    this.backend = backend
    this.handle = db
    this.environments = new EnvironmentsRepository(db)
    this.projects = new ProjectsRepository(db)
    this.repositories = new RepositoriesRepository(db)
    this.settings = new SettingsRepository(db)
    this.github = new GitHubRepository(db)
    this.tasks = new TasksRepository(db)
    this.sessions = new WorkSessionsRepository(db)
    this.activity = new ActivityRepository(db)
  }

  static open(url: string): Database {
    const { db, sql } = createDb(url)
    return new Database(db, {
      migrate: () => migrateWithLock(url),
      applied: () => appliedMigrations(sql),
      legacy: () => holdsLegacySchema(sql),
      ping: async () => void (await sql`SELECT 1`),
      close: () => sql.end({ timeout: 2 }),
    })
  }

  /**
   * A database opened for a test: PGlite, migrated by `createTestDb()`, with no
   * pool to close and nothing to migrate.
   */
  static forTesting(db: Db): Database {
    return new Database(db, {
      migrate: async () => undefined,
      applied: async () => ['0000_initial'],
      legacy: async () => false,
      ping: async () => undefined,
      close: async () => undefined,
    })
  }

  async initialize(): Promise<void> {
    if (this.initializing !== null) return this.initializing
    this.initializing = this.initializeOnce().finally(() => {
      this.initializing = null
    })
    return this.initializing
  }

  private async initializeOnce(): Promise<void> {
    try {
      if (await this.backend.legacy()) throw new LegacyDatabase()
      await this.backend.migrate()
      await this.backend.ping()
      this.markAvailable(await this.backend.applied())
    } catch (error) {
      this.markUnavailable(error)
      throw error
    }
  }

  /**
   * Apply every pending migration, even though boot already did: a file that
   * appeared after boot (the development bind-mount) is otherwise invisible
   * until the next restart.
   */
  async applyMigrations(): Promise<{ migrations: string[]; applied: string[] }> {
    const before = new Set(this.state.migrations)
    try {
      await this.backend.migrate()
      await this.backend.ping()
      const migrations = await this.backend.applied()
      this.markAvailable(migrations)
      return { migrations, applied: migrations.filter((tag) => !before.has(tag)) }
    } catch (error) {
      this.markUnavailable(error)
      throw new DatabaseUnavailable(error instanceof Error ? error.message : String(error))
    }
  }

  async recordEnvironmentsSeen(
    environments: ReadonlyArray<{
      name: string
      workingDir: string | null
      repoUrl: string | null
      gitRoot: string | null
      /** The Compose files Docker recorded; remembered so `up` can run once the containers are gone. */
      operable?: { configFiles: string[] }
    }>,
  ): Promise<void> {
    try {
      // A database that was down during process startup is not abandoned. The
      // next Docker snapshot retries migrations under their advisory lock, then
      // records identity once persistence has recovered.
      if (!this.state.available) await this.initialize()
      await Promise.all(
        environments.map((environment) =>
          this.environments.upsertSeen({
            composeProject: environment.name,
            workingDir: environment.workingDir,
            configFiles: environment.operable?.configFiles ?? [],
            repoUrl: environment.repoUrl,
            repoSubpath: environment.gitRoot,
          }),
        ),
      )
      this.markAvailable(this.state.migrations)
    } catch (error) {
      this.markUnavailable(error)
    }
  }

  status(): DatabaseStatus {
    return { ...this.state, migrations: [...this.state.migrations] }
  }

  private markAvailable(migrations: string[]): void {
    this.state = {
      configured: true,
      available: true,
      reason: null,
      checkedAt: Math.floor(Date.now() / 1000),
      migrations,
    }
  }

  private markUnavailable(error: unknown): void {
    this.state = {
      ...this.state,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      checkedAt: Math.floor(Date.now() / 1000),
    }
  }

  close(): Promise<void> {
    return this.backend.close()
  }
}

export function unavailableDatabaseStatus(configured: boolean, reason: string): DatabaseStatus {
  return { configured, available: false, reason, checkedAt: null, migrations: [] }
}

/**
 * The database is a boot requirement now, so this no longer turns a missing one
 * into a 503 — it turns a *transiently unreachable* one into a 503, which is
 * still worth distinguishing from a bug.
 */
export function requireDatabase(database: Database): Database {
  if (!database.status().available) throw new DatabaseUnavailable()
  return database
}

export type { EnvironmentRecord, EnvironmentRecordCounts, SeenEnvironment } from './environments.ts'
export type { ProjectRecord, ProjectEnvironmentRow } from './projects.ts'
export type { EnvironmentSettingRow, ServiceSettingRow } from './settings.ts'
