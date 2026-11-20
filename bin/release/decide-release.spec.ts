import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../.github/scripts/decide-release.sh', import.meta.url),
);

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
};

type Decision = {
  readonly status: number | null;
  readonly output: string;
  readonly stdout: string;
};

const decide = (
  cwd: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Decision => {
  const outputFile = join(cwd, 'github-output');
  writeFileSync(outputFile, '');
  const result = spawnSync('bash', [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outputFile, ...env },
  });
  return {
    status: result.status,
    output: readFileSync(outputFile, 'utf8').trim(),
    stdout: result.stdout,
  };
};

describe('decide-release.sh', () => {
  let root: string;
  // A checkout like the one the release workflows get: one commit, no tags of its own.
  let checkout: string;
  let unreachable: string;

  const cloneOf = (name: string, remote: string): string => {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', remote);
    return dir;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'decide-release-'));

    const remote = join(root, 'remote');
    mkdirSync(remote);
    git(remote, 'init', '-q');
    git(
      remote,
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'initial',
    );
    for (const tag of [
      'pdf-converter/v1.0.0',
      'pdf-converter/v2.0.0-RC.0',
      'vault-manager/v1.1.7',
      'attachment-text-extractor/v1.0.0',
    ]) {
      git(remote, 'tag', tag);
    }

    checkout = cloneOf('checkout', remote);
    unreachable = cloneOf('unreachable', join(root, 'does-not-exist'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is run against a checkout that holds no tags', () => {
    expect(git(checkout, 'tag', '-l')).toBe('');
  });

  it('does not publish a version whose tag exists on the remote', () => {
    const result = decide(checkout, ['1.0.0', 'attachment-text-extractor']);

    expect(result.status).toBe(0);
    expect(result.output).toBe('should-release=false');
  });

  it('publishes a version whose tag does not exist', () => {
    const result = decide(checkout, ['1.1.0', 'attachment-text-extractor']);

    expect(result.status).toBe(0);
    expect(result.output).toBe('should-release=true');
  });

  it('does not take another package having that version for this one being released', () => {
    const result = decide(checkout, ['1.1.7', 'pdf-converter']);

    expect(result.status).toBe(0);
    expect(result.output).toBe('should-release=true');
  });

  it('does not take the tag of a prerelease for the tag of the release', () => {
    const result = decide(checkout, ['2.0.0', 'pdf-converter']);

    expect(result.status).toBe(0);
    expect(result.output).toBe('should-release=true');
  });

  it('never publishes a prerelease version, without reading the remote', () => {
    const result = decide(unreachable, ['1.2.0-rc.1', 'vault-manager']);

    expect(result.status).toBe(0);
    expect(result.output).toBe('should-release=false');
  });

  it('fails, and says nothing about publishing, when the remote cannot be read', () => {
    const result = decide(unreachable, ['1.2.0', 'vault-manager']);

    expect(result.status).toBe(1);
    expect(result.output).toBe('');
    expect(result.stdout).toContain(
      '::error::Could not read the tags of the remote',
    );
  });

  it('reads the tags from a remote given as the third argument', () => {
    const remote = join(root, 'remote');
    const result = decide(unreachable, ['1.1.7', 'vault-manager', remote]);

    expect(result.status).toBe(0);
    expect(result.output).toBe('should-release=false');
  });

  it('fails on a missing argument', () => {
    const result = decide(checkout, ['1.0.0']);

    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });

  it('fails when it has nowhere to write its answer', () => {
    const result = decide(checkout, ['1.0.0', 'pdf-converter'], {
      GITHUB_OUTPUT: '',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
  });
});
