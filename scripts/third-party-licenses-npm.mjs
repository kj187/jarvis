// Prints the license texts of the production npm packages.
//
// Input (stdin): the JSON of `pnpm licenses list --prod --json`, i.e. an object
// of license id -> package entries with `name`, `versions` and `paths`.
//
// Every package must ship a LICENSE/LICENCE/COPYING file; NOTICE files are
// included when present. A package without one fails the run: shipping its
// code without the notice its license requires is what this guards against.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const input = readFileSync(0, 'utf8')
const groups = JSON.parse(input)

const NOTICE_FILE = /^(licen[sc]e|copying|notice|patents)/i
const LICENSE_FILE = /^(licen[sc]e|copying)/i

const entries = []
for (const [license, packages] of Object.entries(groups)) {
  for (const pkg of packages) {
    pkg.paths.forEach((dir, i) => {
      entries.push({ name: pkg.name, version: pkg.versions[i] ?? pkg.versions[0], license, dir })
    })
  }
}

if (entries.length === 0) {
  console.error('third-party licenses: no npm packages on stdin (did pnpm licenses fail?)')
  process.exit(1)
}

entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

const seen = new Set()
let failed = false
const out = []

for (const { name, version, license, dir } of entries) {
  const key = `${name}@${version}`
  if (seen.has(key)) continue
  seen.add(key)

  let files
  try {
    files = readdirSync(dir).filter((f) => NOTICE_FILE.test(f)).sort()
  } catch {
    console.error(`third-party licenses: ${key} has no package directory (${dir})`)
    failed = true
    continue
  }
  if (!files.some((f) => LICENSE_FILE.test(f))) {
    console.error(`third-party licenses: ${key} (${license}) has no LICENSE/COPYING file`)
    failed = true
    continue
  }

  out.push('='.repeat(80), `${name} ${version} (${license})`, '='.repeat(80))
  for (const f of files) {
    out.push(`--- ${f} ---`, readFileSync(join(dir, f), 'utf8'), '')
  }
}

if (failed) process.exit(1)
process.stdout.write(out.join('\n') + '\n')
