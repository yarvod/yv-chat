import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

function run(command: string, args: string[], cwd: string, env = process.env): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function copyFixture(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

describe('Android release command', () => {
  it('tags a prepared initial version and monotonically bumps later native versions', () => {
    const root = resolve(process.cwd(), '..')
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'yv-chat-native-release-'))
    const repository = join(temporaryRoot, 'repository')
    const remote = join(temporaryRoot, 'remote.git')
    const fakeBin = join(repository, 'test-bin')

    try {
      mkdirSync(fakeBin, { recursive: true })
      copyFixture(
        resolve(root, 'scripts/release-android.sh'),
        join(repository, 'scripts/release-android.sh'),
      )
      copyFixture(
        resolve(root, 'scripts/update-native-version.mjs'),
        join(repository, 'scripts/update-native-version.mjs'),
      )
      mkdirSync(join(repository, 'frontend/ios/App/App.xcodeproj'), { recursive: true })
      writeFileSync(
        join(repository, 'frontend/native-version.properties'),
        'VERSION_CODE=1\nVERSION_NAME=1.0.0\n',
      )
      const xcodeFixture = readFileSync(
        resolve(root, 'frontend/ios/App/App.xcodeproj/project.pbxproj'),
        'utf8',
      )
        .replace(/CURRENT_PROJECT_VERSION = \d+;/g, 'CURRENT_PROJECT_VERSION = 1;')
        .replace(/MARKETING_VERSION = \d+\.\d+\.\d+;/g, 'MARKETING_VERSION = 1.0.0;')
      writeFileSync(
        join(repository, 'frontend/ios/App/App.xcodeproj/project.pbxproj'),
        xcodeFixture,
      )
      chmodSync(join(repository, 'scripts/release-android.sh'), 0o755)
      chmodSync(join(repository, 'scripts/update-native-version.mjs'), 0o755)
      writeFileSync(join(fakeBin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

      run('git', ['init', '-b', 'main'], repository)
      run('git', ['config', 'user.name', 'release-test'], repository)
      run('git', ['config', 'user.email', 'release-test@example.invalid'], repository)
      run('git', ['add', '.'], repository)
      run('git', ['commit', '-m', 'initial'], repository)
      run('git', ['init', '--bare', remote], repository)
      run('git', ['remote', 'add', 'origin', remote], repository)
      run('git', ['push', '-u', 'origin', 'main'], repository)

      const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` }
      const initialOutput = run(
        '/bin/bash',
        ['scripts/release-android.sh', '1.0.0'],
        repository,
        env,
      )
      expect(initialOutput).toContain('Prepared v1.0.0 locally')
      expect(run('git', ['rev-list', '--count', 'HEAD'], repository).trim()).toBe('1')

      const nextOutput = run(
        '/bin/bash',
        ['scripts/release-android.sh', '1.1.0'],
        repository,
        env,
      )
      expect(nextOutput).toContain('Prepared v1.1.0 locally')
      expect(readFileSync(join(repository, 'frontend/native-version.properties'), 'utf8')).toBe(
        'VERSION_CODE=2\nVERSION_NAME=1.1.0\n',
      )
      const xcode = readFileSync(
        join(repository, 'frontend/ios/App/App.xcodeproj/project.pbxproj'),
        'utf8',
      )
      expect(xcode.match(/CURRENT_PROJECT_VERSION = 2;/g)).toHaveLength(2)
      expect(xcode.match(/MARKETING_VERSION = 1\.1\.0;/g)).toHaveLength(2)
      expect(run('git', ['tag', '--list', '--sort=version:refname'], repository).trim()).toBe(
        'v1.0.0\nv1.1.0',
      )
      expect(run('git', ['log', '-1', '--pretty=%s'], repository).trim()).toBe(
        'chore(release): v1.1.0',
      )

      expect(() =>
        run('/bin/bash', ['scripts/release-android.sh', '1.0.5'], repository, env),
      ).toThrow(/must be greater than latest release 1\.1\.0/)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
