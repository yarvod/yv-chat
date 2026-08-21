#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const versionFile = resolve(repositoryRoot, 'frontend/native-version.properties')
const xcodeProject = resolve(repositoryRoot, 'frontend/ios/App/App.xcodeproj/project.pbxproj')
const semverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const versionCodePattern = /^[1-9][0-9]*$/

function fail(message) {
  console.error(`native version: ${message}`)
  process.exit(1)
}

function parseProperties(contents) {
  const properties = new Map()

  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) fail(`invalid property line: ${line}`)
    properties.set(line.slice(0, separator), line.slice(separator + 1))
  }

  return properties
}

function replaceExactly(contents, pattern, replacement, expectedCount, label) {
  let count = 0
  const result = contents.replace(pattern, () => {
    count += 1
    return replacement
  })

  if (count !== expectedCount) {
    fail(`expected ${expectedCount} ${label} entries in Xcode project, found ${count}`)
  }

  return result
}

async function readState() {
  const [propertyContents, xcodeContents] = await Promise.all([
    readFile(versionFile, 'utf8'),
    readFile(xcodeProject, 'utf8'),
  ])
  const properties = parseProperties(propertyContents)
  const versionName = properties.get('VERSION_NAME')
  const versionCode = properties.get('VERSION_CODE')

  if (!versionName || !semverPattern.test(versionName)) {
    fail('VERSION_NAME must be strict numeric SemVer (X.Y.Z)')
  }
  if (!versionCode || !versionCodePattern.test(versionCode)) {
    fail('VERSION_CODE must be a positive integer')
  }

  return { versionName, versionCode, xcodeContents }
}

function assertXcodeVersion(xcodeContents, versionName, versionCode) {
  const marketingVersions = [...xcodeContents.matchAll(/MARKETING_VERSION = ([^;]+);/g)]
  const projectVersions = [...xcodeContents.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)]

  if (marketingVersions.length !== 2 || marketingVersions.some((match) => match[1] !== versionName)) {
    fail(`Xcode MARKETING_VERSION must contain ${versionName} exactly twice`)
  }
  if (projectVersions.length !== 2 || projectVersions.some((match) => match[1] !== versionCode)) {
    fail(`Xcode CURRENT_PROJECT_VERSION must contain ${versionCode} exactly twice`)
  }
}

const [command, requestedName, requestedCode] = process.argv.slice(2)
const current = await readState()

if (command === '--check') {
  assertXcodeVersion(current.xcodeContents, current.versionName, current.versionCode)
  console.log(`native version ${current.versionName} (${current.versionCode}) is synchronized`)
  process.exit(0)
}

if (command !== '--set' || !requestedName || !requestedCode || process.argv.length !== 5) {
  fail('usage: update-native-version.mjs --check | --set X.Y.Z VERSION_CODE')
}
if (!semverPattern.test(requestedName)) fail('requested version must be strict numeric SemVer (X.Y.Z)')
if (!versionCodePattern.test(requestedCode)) fail('requested version code must be a positive integer')

let updatedXcode = replaceExactly(
  current.xcodeContents,
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${requestedName};`,
  2,
  'MARKETING_VERSION',
)
updatedXcode = replaceExactly(
  updatedXcode,
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  `CURRENT_PROJECT_VERSION = ${requestedCode};`,
  2,
  'CURRENT_PROJECT_VERSION',
)

await Promise.all([
  writeFile(versionFile, `VERSION_CODE=${requestedCode}\nVERSION_NAME=${requestedName}\n`, 'utf8'),
  writeFile(xcodeProject, updatedXcode, 'utf8'),
])

console.log(`native version updated to ${requestedName} (${requestedCode})`)
