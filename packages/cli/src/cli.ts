import { Command, CommanderError } from 'commander'
import { CliError, EXIT } from './errors.js'
import { Output } from './output.js'
import { setProcessReporter } from './process.js'
import { accessClose, accessGc, accessInspect, accessList, accessOpen, serviceList, servicePublish, serviceUnpublish } from './commands/access.js'
import { dbDump, dbMigrate, dbOpen, dbRestore, dbShell, dbStatus, dbUrl, clientClose, clientExec, redisOpen } from './commands/clients.js'
import { analyzeCommand, initCommand, namespaceCommand, projectAction, projectList, projectShow, servicesCommand } from './commands/projects.js'
import { bootstrapCommand, devCommand, doctorCommand, downCommand, inspectCommand, logsCommand, resetCommand, restartCommand, statusCommand, updateCommand, upCommand, urlsCommand, versionCommand } from './commands/lifecycle.js'
import { dnsCheck, dnsSetup, dnsStatus, networkStatus, publicDisable, publicEnable, publicStatus } from './commands/network.js'
import { gitClear, gitScan, gitStatus } from './commands/git.js'
import { reposClear, reposScan, reposStatus } from './commands/repos.js'
import { hostCollect, hostStatus, hostWatch } from './commands/host.js'
import { configPrepare, configGet, configList, configSet } from './commands/config.js'
import { setupCommand } from './commands/setup.js'
import { authBootstrap, authLogin, authLogout, authStatus, authTokenCreate, authTokenList, authTokenRevoke, authWhoami } from './commands/auth.js'
import { protectHost, protectStatus, unprotectHost } from './commands/protect.js'
import { authResetPassword, usersCreate, usersGrant, usersList, usersRemove, usersRevoke, usersSetPassword, usersSetRole } from './commands/users.js'
import { shareGc, shareList, shareRevoke } from './commands/share.js'
import { tlsInit, tlsStatus, tlsTrust, tlsUntrust } from './commands/tls.js'
import { backupCommand, repairCommand, restoreCommand } from './commands/maintenance.js'
import { mcpCommand } from './commands/mcp.js'
import { envLogs, overviewCommand, projectsActivity, projectsContext, projectsCreate, projectsList, projectsResources, projectsShow } from './commands/products.js'
import { tasksComment, tasksCreate, tasksDelete, tasksEdit, tasksFinish, tasksGitHubStatus, tasksLink, tasksList, tasksNext, tasksNote, tasksPublish, tasksShow, tasksStart, tasksStatus, tasksSubtaskCreate, tasksSubtaskLink, tasksSubtasks, tasksSync, tasksUnlink } from './commands/tasks.js'
import { examplesApply, tasksImport } from './commands/examples.js'
import { sessionsEnd, sessionsHeartbeat, sessionsList, sessionsStart } from './commands/sessions.js'
import { activityCommand } from './commands/activity.js'
import { buildCommand } from './commands/build.js'
import { remoteAccessClose, remoteAccessList, remoteAccessOpen, remoteBootstrap, remoteExec, remoteGateway } from './commands/remote.js'
import { tunnelDisable, tunnelEnable, tunnelLogs, tunnelSetup, tunnelStatus, tunnelTest } from './commands/tunnel.js'
import { legacy, webBuild, webDisable, webDown, webLogs, webOpen, webRestart, webStatus, webUp } from './commands/web.js'
import { CLI_VERSION } from './version.js'

const VERSION = CLI_VERSION

function describe(command: Command, description: string): Command {
  return command.description(description).showHelpAfterError('(run with --help for usage)')
}

function projectOption(command: Command): Command { return command.requiredOption('--project <name>', 'Compose project name') }
function serviceOption(command: Command, fallback?: string): Command {
  return fallback ? command.option('--service <name>', 'Compose service name', fallback) : command.requiredOption('--service <name>', 'Compose service name')
}

const program = new Command()
program
  .name('portta')
  .description('Shared HTTP/TCP gateway for parallel Docker development')
  .version(`portta ${VERSION}`)
  .option('--json', 'print machine-readable data to stdout')
  .option('-y, --yes', 'confirm non-interactively')
  .option('--quiet', 'suppress progress output')
  .option('--verbose', 'print diagnostic detail to stderr')
  .option('--profile <name>', 'local, remote-private or remote-public')
  .configureOutput({ writeErr: (value) => process.stderr.write(value) })
  .exitOverride()
  // The process layer decides on its own whether a child streams and whether a
  // slow one announces itself. This is the one place the resolved global flags
  // exist before any command runs.
  .hook('preAction', () => setProcessReporter(program.opts()))

describe(program.command('version'), 'Print the installed version').action((_options, command) => versionCommand(command))

describe(program.command('setup'), 'Provision or update a gateway checkout safely')
  .option('--dir <path>', 'gateway checkout directory')
  .option('--repo <url>', 'repository to clone')
  .option('--branch <name>', 'branch to install', 'develop')
  .option('--dry-run', 'print the idempotent plan without changing anything')
  .option('--skip-pull', 'do not pull images')
  .action(setupCommand)

describe(program.command('bootstrap'), 'Prepare this checkout and run diagnostics')
  .option('--skip-pull', 'do not pull component images')
  .action(bootstrapCommand)
describe(program.command('build'), 'Build every local Portta release image from VERSION').action((_options, command) => buildCommand(command))
describe(program.command('up [profile]'), 'Start gateway components')
  .option('--local-release', 'use the locally built release from VERSION')
  .option('--attach', 'run in the foreground')
  .option('--demo', 'also start docker/examples and import their panel records')
  .action(upCommand)
describe(program.command('dev [profile]'), 'Start a checkout from local Dockerfiles, never the published images')
  .option('--reset', 'wipe the panel database first and start as if this checkout were new')
  .option('--demo', 'also start docker/examples and import their panel records')
  .action((profile: string | undefined, options, command) => devCommand(profile, options, command))
describe(program.command('down'), 'Stop gateway components; keep projects and data')
  .option('--demo', 'also stop docker/examples and drop their volumes')
  .action((options, command) => downCommand(options, command))
describe(program.command('reset'), 'Wipe the panel database and restart this checkout as if it were new')
  .option('--demo', 'also recreate docker/examples and import their panel records')
  .action((options, command) => resetCommand(options, command))
describe(program.command('restart'), 'Recreate gateway components').action((_options, command) => restartCommand(command))
describe(program.command('status'), 'Show gateway status').action((_options, command) => statusCommand(command))
describe(program.command('doctor'), 'Run read-only host and gateway diagnostics').action((_options, command) => doctorCommand(command))
describe(program.command('urls'), 'List routed HTTP hostnames').option('--project <name>').action(urlsCommand)
describe(program.command('logs [service]'), 'Follow gateway component logs').option('--no-follow').option('--tail <lines>', 'line count', '200').action(logsCommand)
describe(program.command('inspect'), 'Print resolved configuration without secrets').action((_options, command) => inspectCommand(command))
describe(program.command('update'), 'Pull pinned images and recreate after confirmation').action((_options, command) => updateCommand(command))

const project = describe(program.command('envs'), 'Inspect and operate Compose environments on this host').alias('env').alias('environment').alias('project')
describe(project.command('list'), 'List running Compose environments').action((options, command) => projectList(options, command))
describe(project.command('show <name>'), 'Show one environment, its services and URLs').action((name, _options, command) => projectShow(name, command))
describe(project.command('services'), 'List services across running environments').option('--project <name>').action(servicesCommand)
describe(project.command('analyze <path>'), 'Read-only adoption report')
  .option('--file <path>', 'the Compose file, relative to <path> or absolute; default: compose.yaml and its variants in <path>').action(analyzeCommand)
describe(project.command('init <path>'), 'Write one integration overlay after confirmation')
  .option('--dry-run').option('--service <name:port>', 'service to expose; repeatable', (value, previous: string[]) => previous.concat(value), [])
  .option('--file <path>', 'the Compose file, relative to <path> or absolute; the overlay is written next to it')
  .option('--project <slug>', 'logical Portta Project slug to emit as portta.project')
  .option('--output <file>', 'overlay filename', 'compose.portta.yaml').option('--force').action(initCommand)
describe(project.command('namespace'), 'Derive a collision-safe COMPOSE_PROJECT_NAME')
  .option('--path <dir>').option('--base <name>').option('--suffix <text>').option('--no-check').action(namespaceCommand)
describe(project.command('start <name>'), 'Start every container in a project, dependencies first').action((name, _options, command) => projectAction(name, 'start', command))
describe(project.command('stop <name>'), 'Stop every container in a project, dependents first').action((name, _options, command) => projectAction(name, 'stop', command))
describe(project.command('restart <name>'), 'Stop then start a project in dependency order').action((name, _options, command) => projectAction(name, 'restart', command))
describe(panelOptions(project.command('logs <name>')), "An environment's logs, every service interleaved").option('--service <name>').option('--tail <lines>', 'line count', '200').action(envLogs)
describe(project.command('endpoints <name>'), 'The routed hostnames of one environment').action((name, _options, command) => urlsCommand({ project: name }, command))

const projects = describe(program.command('projects'), 'The products being developed: list, context, resources, activity')
describe(panelOptions(projects.command('list')), 'List Projects').action(projectsList)
describe(panelOptions(projects.command('show <slug>')), 'One Project with its repositories and environments').action((slug, _options, command) => projectsShow(slug, command))
describe(panelOptions(projects.command('create')), 'Create a Project').option('--slug <slug>').option('--name <name>').option('--description <text>').option('--path <dir>', 'first-level directory under Projects Home').action(projectsCreate)
describe(panelOptions(projects.command('context <slug>')), 'The Development Context: what to read before working').option('--task <ref>', 'include one task in full').action(projectsContext)
describe(panelOptions(projects.command('resources <slug>')), "A Project's resource usage, attributed through its environments").action((slug, _options, command) => projectsResources(slug, command))
describe(panelOptions(projects.command('activity <slug>')), 'What happened in a Project').option('--kind <a,b>').option('--limit <n>').action(projectsActivity)
describe(panelOptions(program.command('overview')), 'The Development Dashboard: what is happening on this host').action(overviewCommand)

describe(program.command('services'), 'Compatibility alias for project services').option('--project <name>').action(servicesCommand)
describe(program.command('analyze <path>'), 'Compatibility alias for project analyze')
  .option('--file <path>', 'the Compose file, relative to <path> or absolute').action(analyzeCommand)
describe(program.command('init <path>'), 'Compatibility alias for project init')
  .option('--dry-run').option('--service <name:port>', 'repeatable service', (value, previous: string[]) => previous.concat(value), [])
  .option('--file <path>', 'the Compose file, relative to <path> or absolute')
  .option('--project <slug>', 'logical Portta Project slug to emit as portta.project')
  .option('--output <file>', 'overlay filename', 'compose.portta.yaml').option('--force').action(initCommand)
describe(program.command('namespace'), 'Compatibility alias for project namespace')
  .alias('ns').option('--path <dir>').option('--base <name>').option('--suffix <text>').option('--no-check').action(namespaceCommand)

const access = describe(program.command('access'), 'Open short-lived loopback bridges')
describe(projectOption(serviceOption(access.command('open'))), 'Open a bridge')
  .option('--port <number>').option('--local-port <number>').option('--ttl <duration>').option('--network <name>').option('--bind <ip>', 'bind address', '127.0.0.1').action(accessOpen)
describe(access.command('list').alias('ls'), 'List bridges').action((_options, command) => accessList(command))
describe(access.command('close [id]'), 'Close only gateway-owned bridges').option('--project <name>').option('--all').action(accessClose)
describe(access.command('inspect <id>'), 'Inspect one bridge').action((id, _options, command) => accessInspect(id, command))
describe(access.command('gc'), 'Remove expired and orphaned bridges').action((_options, command) => accessGc(command))

const service = describe(program.command('service'), 'Manage persistent private TCP forwarders')
describe(projectOption(serviceOption(service.command('publish'))), 'Publish a service privately').option('--private').option('--public').option('--port <number>').option('--alias <name>').action(servicePublish)
describe(service.command('list'), 'List private forwarders').action((_options, command) => serviceList(command))
describe(service.command('unpublish [alias]'), 'Remove gateway-owned forwarders').option('--project <name>').action(serviceUnpublish)

const network = describe(program.command('network'), 'Inspect host network exposure')
describe(network.command('status'), 'List published bindings').option('--public-ip', 'make one outbound public-IP lookup').action(networkStatus)
const publicCommand = describe(program.command('public'), 'Control deliberate public HTTP exposure')
describe(publicCommand.command('status'), 'Show current public exposure').action((_options, command) => publicStatus(command))
describe(publicCommand.command('enable'), 'Enable public HTTP after confirmation').action((_options, command) => publicEnable(command))
describe(publicCommand.command('disable'), 'Disable public HTTP').action((_options, command) => publicDisable(command))
const dns = describe(program.command('dns'), 'Inspect or configure wildcard DNS')
describe(dns.command('check'), 'Resolve a wildcard probe').action((_options, command) => dnsCheck(command))
describe(dns.command('status'), 'Show DNS configuration without secrets').action((_options, command) => dnsStatus(command))
describe(dns.command('setup'), 'Plan or apply a Cloudflare wildcard record').option('--target <ip>').option('--dry-run').action(dnsSetup)

const web = describe(program.command('web'), 'Run the optional administration panel').option('--local-release', 'use the locally built release from VERSION')
describe(web.command('up'), 'Enable and start the panel').option('--expose <scope>', 'local, tailscale, public or vpn').option('--port <number>').option('--read-only').option('--writable').action((options, command) => webUp({ ...options, localRelease: command.optsWithGlobals().localRelease }, command))
describe(web.command('dev'), 'Start the panel with hot reload').option('--expose <scope>').option('--port <number>').option('--read-only').option('--writable').action((options, command) => webUp({ ...options, dev: true }, command))
describe(web.command('down'), 'Stop the panel only').action((_options, command) => webDown(command))
describe(web.command('disable'), 'Stop and disable the panel').action((_options, command) => webDisable(command))
describe(web.command('restart'), 'Restart panel containers').action((_options, command) => webRestart(command))
describe(web.command('status'), 'Show panel state and URL').action((_options, command) => webStatus(command))
describe(web.command('open'), 'Print and open the panel URL').action((_options, command) => webOpen(command))
describe(web.command('logs [service]'), 'Follow panel logs').action((service, _options, command) => webLogs(service, command))
describe(web.command('build'), 'Build the panel image').action((_options, command) => webBuild(command))

const config = describe(program.command('config'), 'Read and change settings on an installed gateway')
describe(config.command('prepare'), 'Create or reconcile .env without starting services').action((_options, command) => configPrepare(command))
describe(config.command('list', { isDefault: true }).alias('ls'), 'List the named settings and their values').action((_options, command) => configList(command))
describe(config.command('get <setting>'), 'Print one setting').action((name, _options, command) => configGet(name, command))
describe(config.command('set <setting> <value>'), 'Change one setting and apply it')
  .option('--no-apply', 'write the value without recreating anything')
  .action((name, value, options, command) => configSet(name, value, options, command))

const repos = describe(program.command('repos'), 'Collect repository state (git, commits, instructions) on the host')
describe(repos.command('scan'), 'Collect every repository into state/git').option('--environment <name>', 'only the repository this environment runs from').option('--path <dir>', 'only this repository').option('--with-prs').option('--forge-ttl <seconds>').action(reposScan)
describe(repos.command('status'), 'Show collected repositories and their age').action((_options, command) => reposStatus(command))
describe(repos.command('clear'), 'Remove collected repository files').action((_options, command) => reposClear(command))
const git = describe(program.command('git'), 'Deprecated alias of `portta repos`')
describe(git.command('scan'), 'Deprecated: use `portta repos scan`').option('--project <name>').option('--with-prs').option('--forge-ttl <seconds>').action(gitScan)
describe(git.command('status'), 'Deprecated: use `portta repos status`').action((_options, command) => gitStatus(command))
describe(git.command('clear'), 'Deprecated: use `portta repos clear`').action((_options, command) => gitClear(command))
const host = describe(program.command('host'), 'Collect host and project resource metrics')
describe(host.command('collect'), 'Write one metrics snapshot into state/metrics').action((_options, command) => hostCollect(command))
describe(host.command('watch'), 'Keep collecting host and Docker metrics').option('--loop', 'run in the foreground (used by the detached collector)').action((_options, command) => hostWatch(command))
describe(host.command('status'), 'Show whether the metrics collector is running').action((_options, command) => hostStatus(command))
const share = describe(program.command('share'), 'Manage panel-created temporary shares')
describe(share.command('list'), 'List shares').action((_options, command) => shareList(command))
describe(share.command('revoke <id>'), 'Revoke one share without touching its project').action((id, _options, command) => shareRevoke(id, command))
describe(share.command('gc'), 'Remove expired shares').action((_options, command) => shareGc(command))

const auth = describe(program.command('auth'), 'Who this terminal is, to a panel')
describe(panelOptions(auth.command('status', { isDefault: true }), false), 'Whether this panel asks who you are, and who it thinks you are').action(authStatus)
describe(panelOptions(auth.command('login'), false), 'Save a token for a panel, after checking it')
  .option('--token <token>', 'the token; omitted, it is read from the terminal without echoing')
  .action(authLogin)
describe(panelOptions(auth.command('logout'), false), 'Forget the saved credential for a panel').action(authLogout)
describe(auth.command('whoami'), 'Every panel this host has a credential for').action(authWhoami)
describe(panelOptions(auth.command('bootstrap'), false), 'Create the panel owner, once, from this host')
  .requiredOption('--name <name>').requiredOption('--email <email>').option('--password-stdin')
  .action(authBootstrap)
describe(auth.command('reset-password <email>'), 'Reset a password from the host, when nobody can sign in to do it')
  .option('--password-stdin', 'read the password from stdin instead of generating one')
  .action(authResetPassword)
const authToken = describe(auth.command('token'), 'Personal API tokens for this panel')
describe(panelOptions(authToken.command('list', { isDefault: true })), 'Your tokens, without their secrets')
  .option('--all', "every account's tokens; needs user:list").action(authTokenList)
describe(panelOptions(authToken.command('create'), false), 'Create a token; its secret is shown once')
  .requiredOption('--name <name>').option('--human', 'a person\'s token, holding their whole role')
  .option('--scopes <a,b>', 'permissions this token holds, inside your role')
  .option('--expires-in-days <days>', '1 to 365; omitted, it is valid until revoked')
  .action(authTokenCreate)
describe(panelOptions(authToken.command('revoke <id>')), 'Revoke a token').action(authTokenRevoke)

const protect = describe(program.command('protect'), 'ForwardAuth protection for project hostnames and shares')
describe(protect.command('status [host]', { isDefault: true }), 'List protected hosts without credentials').action((host, _options, command) => protectStatus(host, command))
describe(protect.command('host <host>'), 'Create or rotate a hostname credential')
  .option('--user <name>').option('--password-stdin').option('--entrypoint <name>')
  .option('--label <text>').option('--project <name>').option('--service <name>')
  .action(protectHost)
describe(protect.command('remove <host>'), 'Remove a hostname credential without changing project labels').action((host, _options, command) => unprotectHost(host, command))

const users = describe(program.command('users'), 'The accounts this panel signs in')
describe(panelOptions(users.command('list', { isDefault: true }).alias('ls')), 'List every account').action(usersList)
describe(panelOptions(users.command('create'), false), 'Create an account; a generated password is shown once')
  .requiredOption('--name <name>').requiredOption('--email <email>')
  .option('--role <role>', 'owner, admin, developer or viewer (default: viewer)')
  .option('--projects <a,b>', 'project ids the account starts with')
  .option('--password-stdin')
  .action(usersCreate)
describe(panelOptions(users.command('set-role <email> <role>'), false), "Change an account's role").action(usersSetRole)
describe(panelOptions(users.command('set-password <email>'), false), "Set an account's password and end its sessions")
  .option('--password-stdin').action(usersSetPassword)
describe(panelOptions(users.command('grant <email> <project>'), false), 'Let an account reach one more Project').action(usersGrant)
describe(panelOptions(users.command('revoke <email> <project>'), false), 'Stop an account reaching a Project').action(usersRevoke)
describe(panelOptions(users.command('remove <email>'), false), 'Remove an account').action(usersRemove)

const db = describe(program.command('db'), 'Panel database operations and project database clients')
describe(db.command('status'), 'Show panel PostgreSQL state').action((_options, command) => dbStatus(command))
describe(db.command('migrate'), 'Apply pending panel SQL migrations').action((_options, command) => dbMigrate(command))
describe(db.command('shell'), 'Open an interactive panel psql').action((_options, command) => dbShell(command))
describe(db.command('dump'), 'Write a custom-format panel backup to stdout').action((_options, command) => dbDump(command))
describe(db.command('restore [file]'), 'Restore panel persistence after confirmation').action((file, _options, command) => dbRestore(file, command))
describe(projectOption(db.command('open')), 'Open a project database bridge').option('--service <name>', 'service', 'postgres').option('--port <number>').option('--local-port <number>').action(dbOpen)
describe(projectOption(db.command('close')), 'Close project database bridges').action(clientClose)
describe(projectOption(db.command('url')), 'Print a credential-free bridge URL').option('--service <name>', 'service', 'postgres').action(dbUrl)
describe(projectOption(db.command('psql')), 'Run psql inside the project network').option('--service <name>', 'service', 'postgres').option('--port <number>').option('--user <name>').option('--database <name>').argument('[args...]').action((args, options, command) => clientExec('psql', options, args, command))
describe(projectOption(db.command('mysql')), 'Run mysql inside the project network').option('--service <name>', 'service', 'mysql').option('--port <number>').option('--user <name>').option('--database <name>').argument('[args...]').action((args, options, command) => clientExec('mysql', options, args, command))
const redis = describe(program.command('redis'), 'Reach a project Redis privately')
describe(projectOption(redis.command('open')), 'Open a Redis bridge').option('--service <name>', 'service', 'redis').option('--port <number>').option('--local-port <number>').action(redisOpen)
describe(projectOption(redis.command('close')), 'Close project Redis bridges').action(clientClose)
describe(projectOption(redis.command('cli')), 'Run redis-cli inside the project network').option('--service <name>', 'service', 'redis').option('--port <number>').argument('[args...]').action((args, options, command) => clientExec('redis-cli', options, args, command))

describe(program.command('backup'), 'Archive everything this installation cannot regenerate')
  .option('-o, --output <file>', 'where to write the archive')
  .option('--no-database', 'leave the panel database out')
  .action(backupCommand)
describe(program.command('restore [file]'), 'Put a backup back, keeping what it replaced')
  .option('-f, --force', 'replace configuration under a running gateway')
  .action(restoreCommand)
describe(program.command('repair'), 'Recreate what is missing and fix what is provably wrong')
  .option('--dry-run', 'print the plan without changing anything')
  .action(repairCommand)

/** Every work command talks to the panel API, as the UI and `portta mcp` do. */
function panelOptions(command: Command, includeActor = true): Command {
  const configured = command
    .option('--url <url>', 'the panel API base URL; defaults to the local panel')
    .option('--allow-remote', 'permit a non-loopback panel URL, which is where a credential would be sent')
  return includeActor ? configured.option('--actor <name>', 'who is asking; recorded as X-Portta-Actor (PORTTA_ACTOR)') : configured
}

const tasks = describe(program.command('tasks').alias('task'), "A Project's tasks: what is next, take one, note, finish")
describe(panelOptions(tasks.command('list')), 'List tasks').option('--project <slug>').option('--status <a,b>', 'comma-separated statuses').option('--priority <a,b>').option('--type <type>').option('--label <label>').option('--open', 'only what is not done').option('--mine', 'only tasks assigned to the actor').option('--assignee <name>').option('--agent <name>').option('--repository <id>').option('--environment <name>').option('--service <name>').option('--parent <id>').option('-q, --q <text>', 'substring of the title').action(tasksList)
describe(panelOptions(tasks.command('next')), 'The task to do next, or nothing').option('--project <slug>').action(tasksNext)
describe(panelOptions(tasks.command('show <ref>').alias('view')), 'One task, with comments, subtasks and environments').action((ref, _options, command) => tasksShow(ref, command))
describe(panelOptions(tasks.command('create')), 'Create a task').option('--project <slug>').option('--title <text>').option('--description <text>').option('--priority <level>', 'low, medium, high or urgent').option('--status <status>').option('--type <type>').option('--parent <ref>').option('--repository <id>').option('--environment <name>').option('--service <name>').option('--labels <a,b>').option('--assignee <name>').option('--agent <name>').option('--deadline <date>', 'YYYY-MM-DD').action(tasksCreate)
describe(panelOptions(tasks.command('start <ref>')), 'Take a task: in_progress, assigned to the actor').option('--no-assign', 'move it without assigning').action(tasksStart)
describe(panelOptions(tasks.command('status <ref> <status>')), 'Move a task to one status').action(tasksStatus)
describe(panelOptions(tasks.command('move <ref> <status>')), 'Move a task to a status and append it to that column').action(tasksStatus)
describe(panelOptions(tasks.command('finish <ref>').alias('complete')), 'Finish a task').option('--close', 'close the bound GitHub issue as well').action(tasksFinish)
describe(panelOptions(tasks.command('delete <ref>')), 'Delete a task and its subtasks').action((ref, _options, command) => tasksDelete(ref, command))
describe(panelOptions(tasks.command('edit <ref>').alias('update')), 'Change a task').option('--title <text>').option('--description <text>').option('--status <status>').option('--priority <level>', 'a level, or none').option('--type <type>').option('--assignee <name>', 'a name, or none').option('--agent <name>', 'a name, or none').option('--parent <ref>', 'a task, or none').option('--repository <id>', 'an id, or none').option('--environment <name>', 'an environment, or none').option('--service <name>', 'a service, or none').option('--deadline <date>', 'YYYY-MM-DD or none').option('--labels <a,b>').action(tasksEdit)
describe(panelOptions(tasks.command('note <ref> <text>')), 'Add a local note').action(tasksNote)
describe(panelOptions(tasks.command('subtasks <ref>')), 'The subtask tree').action((ref, _options, command) => tasksSubtasks(ref, command))
const taskSubtask = describe(tasks.command('subtask'), 'Create, link and list subtasks')
describe(panelOptions(taskSubtask.command('list <ref>')), 'List a task’s subtask tree').action((ref, _options, command) => tasksSubtasks(ref, command))
describe(panelOptions(taskSubtask.command('create <ref>')), 'Create a subtask').requiredOption('--title <text>').option('--status <status>').option('--repository <id>').action(tasksSubtaskCreate)
describe(panelOptions(taskSubtask.command('link <ref> <child>')), 'Link an existing task as a subtask').action(tasksSubtaskLink)
describe(panelOptions(tasks.command('link <ref> <issue>')), 'Bind a task to a projected GitHub issue (owner/repo#n)').option('--pull', 'start by importing GitHub fields').option('--push', 'start by publishing Portta fields').action(tasksLink)
describe(panelOptions(tasks.command('unlink <ref>')), 'Remove the GitHub binding').action((ref, _options, command) => tasksUnlink(ref, command))
describe(panelOptions(tasks.command('publish <ref>')), 'Open a GitHub issue for a task and bind them').option('--repository <owner/name>').action(tasksPublish)
describe(panelOptions(tasks.command('sync <ref>')), 'Push a pending edit to GitHub, or settle a conflict').option('--resolve <side>', 'local or remote').action(tasksSync)
describe(panelOptions(tasks.command('comment <ref> [text]')), 'Add a local Markdown comment').option('-m, --message <text>').option('--file <path>').option('--stdin').action(tasksComment)
for (const [name, status] of [['block', 'blocked'], ['review', 'review'], ['reopen', 'in_progress']] as const) {
  describe(panelOptions(tasks.command(`${name} <ref>`)), `${name} a task`).action((ref, _options, command) => tasksStatus(ref, status, {}, command))
}
const taskGitHub = describe(tasks.command('github'), 'Operate the optional GitHub issue binding')
describe(panelOptions(taskGitHub.command('status <ref>')), 'Show GitHub binding state').action((ref, _options, command) => tasksGitHubStatus(ref, command))
describe(panelOptions(taskGitHub.command('link <ref> <issue>')), 'Link an issue').option('--pull').option('--push').action(tasksLink)
describe(panelOptions(taskGitHub.command('publish <ref>')), 'Publish as a new GitHub issue').option('--repository <owner/name>').action(tasksPublish)
describe(panelOptions(taskGitHub.command('sync <ref>')), 'Synchronize the binding').option('--resolve <side>', 'local or remote').action(tasksSync)
describe(panelOptions(tasks.command('import')), 'Import a versioned task document').option('--project <slug>').option('--file <path>').action(tasksImport)

const examples = describe(program.command('examples'), 'Declarative example projects and their tasks')
describe(panelOptions(examples.command('apply')), 'Create example projects and import their tasks (idempotent)').option('--file <path>', 'one manifest instead of docker/examples/*/portta.example.json').action(examplesApply)

const sessions = describe(program.command('sessions'), 'Say who is working on what, since when')
describe(panelOptions(sessions.command('list')), 'List sessions').option('--project <slug>').option('--active', 'only active sessions').action(sessionsList)
describe(panelOptions(sessions.command('start')), 'Start a session').option('--project <slug>').option('--task <ref>').option('--repository <id>').option('--environment <name>').option('--summary <text>').option('--head <sha>', 'HEAD before the work started').action(sessionsStart)
describe(panelOptions(sessions.command('end <id>')), 'End a session').option('--summary <text>').option('--abandon', 'mark it abandoned rather than ended').option('--head <sha>', 'HEAD after the work').action(sessionsEnd)
describe(panelOptions(sessions.command('heartbeat <id>')), 'Say a session is still alive').action((id, _options, command) => sessionsHeartbeat(id, command))

describe(panelOptions(program.command('activity')), 'What happened, newest first').option('--project <slug>').option('--kind <a,b>', 'comma-separated event kinds').option('--task <ref>').option('--repository <id>').option('--environment <name>').option('--limit <n>').action(activityCommand)

describe(program.command('mcp'), 'Serve the task verbs to an agent over stdio (MCP)')
  .option('--url <url>', 'the panel API base URL; defaults to the local panel')
  .option('--allow-remote', 'permit a non-loopback panel URL, which is where a credential would be sent')
  .option('--actor <name>', 'recorded on every write as X-Portta-Actor', 'agent')
  .action(mcpCommand)

const remote = describe(program.command('remote'), 'Operate a gateway on another host over SSH')
describe(remote.command('bootstrap <target>'), 'Prepare a host and start the gateway there')
  .option('--profile <name>', 'profile to configure', 'remote-private')
  .option('--dir <path>', 'where to install', 'portta')
  .option('--repo <url>', "repository to clone; defaults to this repo's origin")
  .option('--branch <name>', 'branch to check out', 'main')
  .option('--install-docker', 'offer to install Docker when it is missing')
  .option('--dry-run', 'print what would happen, change nothing')
  .action(remoteBootstrap)
for (const name of ['status', 'doctor', 'urls'] as const) {
  describe(remote.command(`${name} <target>`), `Run \`portta ${name}\` there`).action((target, _options, command) => remoteGateway(name, target, command))
}
describe(remote.command('exec <target> [args...]'), 'Run an arbitrary command there')
  .allowUnknownOption(true).action((target, args, _options, command) => remoteExec(target, args, command))
const remoteAccess = describe(remote.command('access'), "Reach a remote project's private TCP services")
describe(remoteAccess.command('open <target>'), 'Open a remote bridge and a tunnel to it')
  .requiredOption('--project <name>', 'Compose project name')
  .requiredOption('--service <name>', 'Compose service name')
  .option('--port <number>', 'the port inside the service')
  .option('--local-port <number>', 'the port to listen on here')
  .option('--dir <path>', 'the gateway directory on the remote host', 'portta')
  .action(remoteAccessOpen)
describe(remoteAccess.command('list', { isDefault: true }).alias('ls'), 'List open tunnels').action((_options, command) => remoteAccessList(command))
describe(remoteAccess.command('close [id]'), 'Close one tunnel, or all of them').option('--all').action(remoteAccessClose)

const tunnel = describe(program.command('tunnel'), 'Publish services over HTTPS with no open port')
describe(tunnel.command('status', { isDefault: true }), "Show the connector's state and the routes it serves").action((_options, command) => tunnelStatus(command))
describe(tunnel.command('setup'), 'Write the connector configuration from a tunnel token')
  .requiredOption('--zone <domain>', 'the domain whose wildcard points at the tunnel')
  .option('--token-file <path>', 'read the tunnel token from a file')
  .option('--origin <url>', 'where the connector reaches the proxy')
  .option('--apex', 'serve the zone apex as well as the wildcard')
  // Registered only so it can be refused with a reason: a token on a command
  // line is visible in `ps` to every user on the host.
  .option('--token <value>', 'refused; use --token-file or the prompt')
  .action(tunnelSetup)
describe(tunnel.command('enable'), 'Start the connector').action((_options, command) => tunnelEnable(command))
describe(tunnel.command('disable'), 'Stop the connector, keeping the configuration')
  .option('--forget', 'delete the configuration and credentials too').action(tunnelDisable)
describe(tunnel.command('test'), 'Check that the tunnel is carrying traffic').action((_options, command) => tunnelTest(command))
describe(tunnel.command('logs'), "Show the connector's own output").option('-n, --lines <count>', 'line count', '50').action(tunnelLogs)

const tls = describe(program.command('tls'), 'Drive local certificates with openssl')
describe(tls.command('status', { isDefault: true }), 'Show certificate and TLS configuration').action((_options, command) => tlsStatus(command))
describe(tls.command('init'), 'Create a local CA and a wildcard certificate for the domain').action((_options, command) => tlsInit(command))
describe(tls.command('trust'), 'Print the command to trust the CA on this machine').action((_options, command) => tlsTrust(command))
describe(tls.command('untrust'), 'Print the command to remove it again').action((_options, command) => tlsUntrust(command))
/**
 * `bin/portta` hands over to this file whenever Node is present, so a command
 * the Bash dispatcher has and Commander does not is unreachable on every host
 * the installer touched — `portta tunnel status` exited 2 with `unknown
 * command` while its implementation sat intact behind `PORTTA_FORCE_BASH`.
 *
 * These passthroughs are the cheap half of the fix and are deliberately
 * temporary: #29 deletes each one in the change that ports it. The parity
 * assertion in `tests/unit/cli.test.sh` is what stops the two surfaces
 * drifting apart again.
 */
const passthroughs = [['toolbox', 'Run pinned operational tools in Docker']] as const
for (const [name, description] of passthroughs) {
  /**
   * `helpOption(false)` matters more than it looks. Each of these commands
   * already prints a page of its own — subcommands, flags, and the reason
   * `tunnel setup` refuses a token on the command line. Commander's built-in
   * `--help` would intercept that and answer with a four-line stub naming
   * `[args...]`, which is how `portta remote --help` has been answering.
   * Forwarding the flag keeps the real page.
   */
  describe(program.command(`${name} [args...]`), description).helpOption(false).allowUnknownOption(true).allowExcessArguments(true).action((args, _options, command) => legacy(name, args, command))
}

/**
 * `portta status | head -3` is an ordinary thing to type, and it made Node
 * throw an unhandled EPIPE and print a stack trace over the output the reader
 * asked for. A closed downstream pipe is not an error here: it means the
 * reader has what they wanted.
 */
function tolerateClosedOutput(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') process.exit(0)
      throw error
    })
  }
}

async function main(): Promise<void> {
  tolerateClosedOutput()
  try {
    if (process.argv.length === 2) {
      program.outputHelp()
      return
    }
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return
      process.exitCode = EXIT.usage
      return
    }
    const output = new Output(program.opts())
    if (error instanceof CliError) {
      output.error(error.message)
      if (error.hint) output.hint(error.hint)
      process.exitCode = error.exitCode
      return
    }
    output.error(error instanceof Error ? error.message : String(error))
    process.exitCode = EXIT.failure
  }
}

await main()
