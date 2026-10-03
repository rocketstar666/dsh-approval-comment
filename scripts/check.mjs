// Contract validation for the dsh-approval-comment package. Pure Node built-ins,
// no dependencies, no subprocess — safe to run in CI and under sandboxing.
//
// It asserts the wiring the dsh runtime relies on, so a broken package fails
// loudly before `dsh plugin --profile web add ...` would surface it as a boot
// error.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []
const ok = (condition, message) => {
  if (condition) return
  failures.push(message)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = pkg.name
ok(typeof name === 'string' && name.length > 0, 'package.json: name is required')
ok(pkg.type === 'module', 'package.json: type must be "module"')
ok(pkg.exports?.['.'] === './lib/index.js', 'package.json: exports["."] must resolve the host entry')
ok(pkg.exports?.['./client'] === './lib/client.js', 'package.json: exports["./client"] must resolve the client bundle')
ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json: dsh.bundle.patch must point at cordis.patch.yml')
ok(pkg.dsh?.client?.platform === 'web', 'package.json: dsh.client.platform must be "web"')
ok(
  Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
  'package.json: dsh.client.inject must include @deepseek-ai/dsh-client-ui-conversation (slot declaration + conversation service)',
)

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
ok(patch.includes(`name: ${name}`), `cordis.patch.yml: must insert the row with name: ${name}`)
ok(/insert:/.test(patch), 'cordis.patch.yml: must contain an insert block')

const host = readFileSync(join(root, 'lib/index.js'), 'utf8')
ok(host.includes("export const name = 'dsh-approval-comment'"), 'lib/index.js: must export name')
ok(host.includes('export function apply'), 'lib/index.js: must export apply')
ok(host.includes("'approval/request'"), "lib/index.js: must observe 'approval/request'")
ok(host.includes('prepend: true'), 'lib/index.js: approval listener must prepend (run before the web answerer)')
ok(host.includes("'agent/pre-step'"), "lib/index.js: must observe 'agent/pre-step'")
ok(host.includes("{ kind: 'reject' }"), "lib/index.js: must return { kind: 'reject' } to terminate the turn")

const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
ok(client.includes(`id: '${name}'`), `lib/client.js: __ModuleLoader__ id must match package name "${name}"`)
ok(client.includes("name: 'conversation.composer'"), 'lib/client.js: must register into conversation.composer')
ok(client.includes('priority: 0'), 'lib/client.js: must register at priority 0 (shadow the built-in panel)')
ok(client.includes('rejected'), 'lib/client.js: must be able to answer "rejected"')
ok(client.includes('allowed-once'), 'lib/client.js: must be able to answer "allowed-once"')
ok(client.includes('prompt('), 'lib/client.js: must deliver the comment via the session prompt path')
ok(client.includes("'steer'"), 'lib/client.js: must steer the comment into the running turn')
ok(client.includes("'queue'"), 'lib/client.js: must fall back to a queued turn when steering is unavailable')

if (failures.length > 0) {
  console.error(`[check] ${failures.length} contract failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`[check] dsh-approval-comment@${pkg.version} — all ${name ? '' : ''}contracts satisfied`)
console.log(`[check]   host entry : lib/index.js`)
console.log(`[check]   client half: lib/client.js (platform=web)`)
console.log(`[check]   patch layer: cordis.patch.yml (insert ${name})`)
