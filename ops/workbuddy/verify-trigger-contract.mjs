#!/usr/bin/env node

import { readFileSync } from 'node:fs'

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`)
  process.exit(1)
}

let contractPath = ''
let migrationCount = ''
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (argument === '--contract' && index + 1 < process.argv.length) contractPath = process.argv[++index]
  else if (argument === '--migration-count' && index + 1 < process.argv.length) migrationCount = process.argv[++index]
  else fail('trigger verifier arguments are invalid')
}

if (!contractPath) fail('--contract is required')
if (!['5', '6', '7', '8'].includes(migrationCount)) fail('migration count must be in the approved 5..8 range')

let contract
try {
  contract = JSON.parse(readFileSync(contractPath, 'utf8'))
} catch {
  fail('trigger contract cannot be read')
}

function names(value, label) {
  if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name))) {
    fail(`trigger contract section is invalid: ${label}`)
  }
  const sorted = [...value].sort()
  if (new Set(sorted).size !== sorted.length) fail(`trigger contract section contains duplicates: ${label}`)
  return sorted
}

const migration5 = names(contract.triggersThroughMigration5, 'triggersThroughMigration5')
const migration6Additions = names(contract.migration6TriggerAdditions, 'migration6TriggerAdditions')
const migration7Additions = names(contract.migration7TriggerAdditions, 'migration7TriggerAdditions')
const migration8Additions = names(contract.migration8TriggerAdditions, 'migration8TriggerAdditions')
const expectedByMigration = {
  '5': migration5,
  '6': [...migration5, ...migration6Additions].sort(),
  '7': [...migration5, ...migration6Additions, ...migration7Additions].sort(),
  '8': [...migration5, ...migration6Additions, ...migration7Additions, ...migration8Additions].sort(),
}

const actual = readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean)
if (actual.some((name) => !/^[a-z][a-z0-9_]*$/.test(name)) || new Set(actual).size !== actual.length) {
  fail('database trigger names are malformed or duplicated')
}

const expected = expectedByMigration[migrationCount]
const expectedSet = new Set(expected)
const actualSet = new Set(actual)
if (actual.some((name) => !expectedSet.has(name))) fail('database trigger set contains an unapproved trigger')
if (expected.some((name) => !actualSet.has(name))) fail('database trigger set is missing a required trigger')
if (actual.length !== expected.length) fail('database trigger set does not match the approved contract')

process.stdout.write(`OK: SQLite trigger contract matches migration ledger ${migrationCount}\n`)
