import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encodePktLine } from './vault-pkt-line.js';
import { findWantsOutsideView, peekWantSection } from './vault-want-guard.js';

const execFileAsync = promisify(execFile);
const FLUSH = Buffer.from('0000');

// ---------------------------------------------------------------------------
// peekWantSection
// ---------------------------------------------------------------------------

describe('peekWantSection', () => {
  const OID = 'a'.repeat(40);
  const wantSection = Buffer.concat([
    encodePktLine(`want ${OID} side-band-64k\n`),
    FLUSH,
  ]);
  const remainder = Buffer.concat([
    encodePktLine(`have ${'b'.repeat(40)}\n`),
    encodePktLine('done\n'),
  ]);

  /** Drains a stream into a single Buffer. */
  const drain = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  };

  it('reports the wants found at the head of the request', async () => {
    const stream = Readable.from([wantSection, remainder]);

    const result = await peekWantSection(stream);

    expect(result).toMatchObject({ status: 'complete', wants: [OID] });
  });

  it('leaves the rest of the request readable, so the peeked bytes plus the remainder reproduce the original body', async () => {
    // This is the property upload-pack depends on: the guard only looks at the
    // head, and the body it finally receives must be byte-identical to what the
    // client sent. A peek that consumes or destroys the stream loses the
    // negotiation ("done") and makes the git process hang.
    const body = Buffer.concat([wantSection, remainder]);
    const stream = Readable.from([wantSection, remainder]);

    const result = await peekWantSection(stream);
    const rest = await drain(stream);

    expect(Buffer.concat([result.prefix, rest])).toEqual(body);
    expect(rest.length).toBeGreaterThan(0);
  });

  it('finds the wants even when the section is split across chunks', async () => {
    const body = Buffer.concat([wantSection, remainder]);
    const stream = Readable.from([
      body.subarray(0, 7),
      body.subarray(7, 30),
      body.subarray(30),
    ]);

    const result = await peekWantSection(stream);
    const rest = await drain(stream);

    expect(result).toMatchObject({ status: 'complete', wants: [OID] });
    expect(Buffer.concat([result.prefix, rest])).toEqual(body);
  });

  it('reports the partial-clone filter alongside the wants', async () => {
    const filtered = Buffer.concat([
      encodePktLine(`want ${OID} side-band-64k filter\n`),
      encodePktLine('filter blob:none\n'),
      FLUSH,
    ]);
    const stream = Readable.from([filtered, remainder]);

    const result = await peekWantSection(stream);

    expect(result).toMatchObject({
      status: 'complete',
      wants: [OID],
      filters: ['blob:none'],
    });
  });

  it('reports the request as invalid when it ends before the want section does', async () => {
    const stream = Readable.from([encodePktLine(`want ${OID}\n`)]);

    const result = await peekWantSection(stream);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('reports the request as invalid when the head is not a v0 want section', async () => {
    const stream = Readable.from([
      Buffer.concat([encodePktLine('command=fetch\n'), Buffer.from('0001')]),
    ]);

    const result = await peekWantSection(stream);

    expect(result).toMatchObject({ status: 'invalid' });
  });
});

// ---------------------------------------------------------------------------
// findWantsOutsideView
// ---------------------------------------------------------------------------

/**
 * These cases run against a real bare repository with two namespaces, because
 * the behaviour under test is git's own reachability answer — a mocked git
 * would only prove that the mock was called.
 */
describe('findWantsOutsideView', () => {
  let repoPath: string;
  let workDir: string;
  let ownTip: string;
  let ownParent: string;
  let ownBlob: string;
  let otherTip: string;
  let otherBlob: string;
  let otherTree: string;
  let danglingBlob: string;

  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
    return stdout.trim();
  };

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-want-guard-'));
    repoPath = path.join(root, 'repo.git');
    workDir = path.join(root, 'work');
    fs.mkdirSync(workDir);

    await git(root, 'init', '--bare', '-q', repoPath);
    await git(workDir, 'init', '-q', '-b', 'main');

    // Namespace 'own-view': two commits.
    fs.writeFileSync(path.join(workDir, 'own.md'), 'own content\n');
    await git(workDir, 'add', '.');
    await git(workDir, 'commit', '-q', '-m', 'own 1');
    ownParent = await git(workDir, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(workDir, 'own2.md'), 'own content 2\n');
    await git(workDir, 'add', '.');
    await git(workDir, 'commit', '-q', '-m', 'own 2');
    ownTip = await git(workDir, 'rev-parse', 'HEAD');
    ownBlob = await git(workDir, 'rev-parse', 'HEAD:own.md');
    await git(
      workDir,
      'push',
      '-q',
      repoPath,
      'HEAD:refs/namespaces/own-view/refs/heads/main',
    );

    // Namespace 'other-view': a separate history the requester cannot see.
    await git(workDir, 'checkout', '-q', '--orphan', 'other');
    await git(workDir, 'rm', '-q', '-rf', '.');
    fs.writeFileSync(path.join(workDir, 'secret.md'), 'another users page\n');
    await git(workDir, 'add', '.');
    await git(workDir, 'commit', '-q', '-m', 'other 1');
    otherTip = await git(workDir, 'rev-parse', 'HEAD');
    otherBlob = await git(workDir, 'rev-parse', 'HEAD:secret.md');
    otherTree = await git(workDir, 'rev-parse', 'HEAD^{tree}');
    await git(
      workDir,
      'push',
      '-q',
      repoPath,
      'HEAD:refs/namespaces/other-view/refs/heads/main',
    );

    // An object that exists in the shared store but no ref reaches.
    const danglingSource = path.join(root, 'dangling.txt');
    fs.writeFileSync(danglingSource, 'unreferenced content\n');
    danglingBlob = await git(repoPath, 'hash-object', '-w', danglingSource);
  }, 60_000);

  afterAll(() => {
    if (repoPath != null) {
      fs.rmSync(path.dirname(repoPath), { recursive: true, force: true });
    }
  });

  it('allows the commit the view currently advertises', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [ownTip],
    });

    expect(disallowed).toEqual([]);
  });

  it('allows an ancestor of the advertised commit, so a view that moved between advertisement and fetch still serves', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [ownParent],
    });

    expect(disallowed).toEqual([]);
  });

  it('rejects a file body that belongs to another view', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [otherBlob],
    });

    expect(disallowed).toEqual([otherBlob]);
  });

  it('rejects a directory listing that belongs to another view', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [otherTree],
    });

    expect(disallowed).toEqual([otherTree]);
  });

  it('rejects a commit that belongs to another view', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [otherTip],
    });

    expect(disallowed).toEqual([otherTip]);
  });

  it('rejects an object that no ref reaches at all', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [danglingBlob],
    });

    expect(disallowed).toEqual([danglingBlob]);
  });

  it('collapses a repeated OID, so a client cannot multiply the work by repeating one want', async () => {
    // A 64 KiB want section holds ~1300 want lines. Without collapsing, each
    // one costs a git process, letting one cheap request spawn a burst of them.
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: Array.from({ length: 300 }, () => otherBlob),
    });

    expect(disallowed).toEqual([otherBlob]);
  });

  it('refuses the whole request when it carries more distinct wants than any git client would send', async () => {
    // 65 distinct wants, one of which the view really does reach. Over the
    // limit the request is refused as a whole, so even that one is denied.
    const wants = [
      ownTip,
      ...Array.from(
        { length: 64 },
        (_, i) => `${'0'.repeat(38)}${i.toString(16).padStart(2, '0')}`,
      ),
    ];

    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants,
    });

    expect(disallowed).toContain(ownTip);
  });

  it('still answers a request that sits just inside the distinct-want limit', async () => {
    const wants = [
      ownTip,
      ...Array.from(
        { length: 63 },
        (_, i) => `${'0'.repeat(38)}${i.toString(16).padStart(2, '0')}`,
      ),
    ];

    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants,
    });

    expect(disallowed).not.toContain(ownTip);
    expect(disallowed).toHaveLength(63);
  });

  it('rejects a file body from the requester own view, because a blob is never a valid want here', async () => {
    // The view advertises a commit; a client that asks for a blob directly is
    // either doing a partial-clone lazy fetch (not supported) or probing.
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [ownBlob],
    });

    expect(disallowed).toEqual([ownBlob]);
  });

  it('reports only the offending OID when a request mixes an allowed and a denied want', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [ownTip, otherBlob],
    });

    expect(disallowed).toEqual([otherBlob]);
  });

  it('rejects every want when the view ref does not exist', async () => {
    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'no-such-view',
      wants: [ownTip],
    });

    expect(disallowed).toEqual([ownTip]);
  });

  it('rejects an OID that is not present in the repository', async () => {
    const absent = 'f'.repeat(40);

    const disallowed = await findWantsOutsideView({
      repoPath,
      viewRef: 'own-view',
      wants: [absent],
    });

    expect(disallowed).toEqual([absent]);
  });
});
