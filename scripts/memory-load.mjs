#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const defaults = {
  baseUrl: 'http://127.0.0.1:8080',
  route: '/api/v1/alerts?state=resolved',
  concurrency: 1,
  durationSeconds: 600,
  warmupSeconds: 60,
  output: 'tmp/memory-results/load.json',
}

function usage() {
  return `Usage: node scripts/memory-load.mjs [options]

Options:
  --base-url URL             Loopback Jarvis URL (default ${defaults.baseUrl})
  --route PATH               Route including query (default ${defaults.route})
  --concurrency N            Parallel requests (default ${defaults.concurrency})
  --duration-seconds N       Measured duration (default ${defaults.durationSeconds})
  --warmup-seconds N         Warmup duration (default ${defaults.warmupSeconds})
  --output FILE              JSON result file (default ${defaults.output})
  --help                     Show this help
`
}

function parsePositiveInteger(name, value, allowZero = false) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
    throw new Error(`${name} is out of range`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = { ...defaults }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--help') return { help: true }
    const value = argv[++i]
    if (value === undefined) throw new Error(`missing value for ${key}`)
    switch (key) {
      case '--base-url': options.baseUrl = value; break
      case '--route': options.route = value; break
      case '--concurrency': options.concurrency = parsePositiveInteger(key, value); break
      case '--duration-seconds': options.durationSeconds = parsePositiveInteger(key, value); break
      case '--warmup-seconds': options.warmupSeconds = parsePositiveInteger(key, value, true); break
      case '--output': options.output = value; break
      default: throw new Error(`unknown option ${key}`)
    }
  }
  return options
}

function targetURL(options) {
  const base = new URL(options.baseUrl)
  if (!['127.0.0.1', '[::1]', '::1', 'localhost'].includes(base.hostname)) {
    throw new Error('--base-url must use a loopback host')
  }
  if (!options.route.startsWith('/')) throw new Error('--route must start with /')
  return new URL(options.route, base)
}

const maxLatencyMs = 15_000

function accumulator() {
  return {
    attempts: 0,
    statuses: {},
    aborts: 0,
    responseBytes: 0,
    latencyBuckets: new Uint32Array(maxLatencyMs + 1),
  }
}

function record(target, sample) {
  target.attempts += 1
  if (sample.aborted) target.aborts += 1
  if (sample.status !== undefined) target.statuses[sample.status] = (target.statuses[sample.status] ?? 0) + 1
  target.responseBytes += sample.responseBytes
  const bucket = Math.min(maxLatencyMs, Math.max(0, Math.ceil(sample.latencyMs)))
  target.latencyBuckets[bucket] += 1
}

function percentile(target, fraction) {
  if (target.attempts === 0) return 0
  const wanted = Math.ceil(target.attempts * fraction)
  let seen = 0
  for (let milliseconds = 0; milliseconds < target.latencyBuckets.length; milliseconds += 1) {
    seen += target.latencyBuckets[milliseconds]
    if (seen >= wanted) return milliseconds
  }
  return maxLatencyMs
}

function summary(target) {
  return {
    attempts: target.attempts,
    statuses: target.statuses,
    aborts: target.aborts,
    responseBytes: target.responseBytes,
    latencyMs: {
      p50: percentile(target, 0.50),
      p95: percentile(target, 0.95),
      p99: percentile(target, 0.99),
      max: percentile(target, 1),
    },
  }
}

async function consume(response) {
  let bytes = 0
  if (!response.body) return bytes
  for await (const chunk of response.body) bytes += chunk.byteLength
  return bytes
}

async function runPhase(url, concurrency, durationMs, collect) {
  const deadline = performance.now() + durationMs
  const buckets = new Map()
  const aggregate = accumulator()
  async function worker() {
    while (performance.now() < deadline) {
      const started = performance.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      let sample
      try {
        const response = await fetch(url, { signal: controller.signal })
        const responseBytes = await consume(response)
        sample = { status: response.status, responseBytes, aborted: false, latencyMs: performance.now() - started }
      } catch (error) {
        sample = { responseBytes: 0, aborted: error?.name === 'AbortError', latencyMs: performance.now() - started }
      } finally {
        clearTimeout(timeout)
      }
      if (collect) {
        record(aggregate, sample)
        const second = Math.floor(started / 1000)
        const bucket = buckets.get(second) ?? accumulator()
        record(bucket, sample)
        buckets.set(second, bucket)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return {
    aggregate: summary(aggregate),
    seconds: [...buckets.entries()].sort(([a], [b]) => a - b).map(([second, bucket]) => ({ second, ...summary(bucket) })),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const url = targetURL(options)
  await runPhase(url, options.concurrency, options.warmupSeconds * 1000, false)
  const startedAt = new Date().toISOString()
  const { aggregate, seconds } = await runPhase(url, options.concurrency, options.durationSeconds * 1000, true)
  const result = { ...options, url: url.toString(), startedAt, finishedAt: new Date().toISOString(), aggregate, seconds }
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result.aggregate)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
