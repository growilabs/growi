import { describe, expect, it } from 'vitest';

import { parse, selectNewestMatch } from './repro-result.ts';

const CASE1_SHA = 'b9a64ded27e0ce4cc30a0563d5be5133db0f027a';
const CASE1_BODY = [
  '### Repro result',
  '',
  `- Commit: ${CASE1_SHA}`,
  '- Branch: flaky-repro/issue-11823-replace-procedure',
  '- Mode: file',
  '- Runs: 3',
  '- Failed: 0',
  '- Per-run: pass, pass, pass',
  '- Workflow run: https://github.com/growilabs/growi/actions/runs/34867613127',
  '',
].join('\n');

describe('repro-result.parse', () => {
  it('parses runs, failed, per-run and the workflow run URL for a matching commit', () => {
    expect(parse(CASE1_BODY, CASE1_SHA)).toEqual({
      runs: 3,
      failed: 0,
      perRun: ['pass', 'pass', 'pass'],
      workflowRunUrl:
        'https://github.com/growilabs/growi/actions/runs/34867613127',
    });
  });

  it('returns null when the commit line names a different SHA', () => {
    expect(
      parse(CASE1_BODY, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
    ).toBeNull();
  });

  it('returns null for a comment that is not a ### Repro result comment', () => {
    const body = `### Additional observation\n\n- Commit: ${CASE1_SHA}\n- Runs: 3\n- Failed: 0\n`;
    expect(parse(body, CASE1_SHA)).toBeNull();
  });

  it('takes the first "- Failed:" line, not one that appears inside a trailing excerpt', () => {
    // The real comment shape: the seven fixed lines, then a fenced excerpt of
    // the failing run's own output, which can itself contain a line starting
    // with "- Failed:". `grep -m1` used to be load-bearing for exactly this.
    const body = [
      '### Repro result',
      '',
      `- Commit: ${CASE1_SHA}`,
      '- Branch: flaky-repro/issue-11823-replace-procedure',
      '- Mode: file',
      '- Runs: 3',
      '- Failed: 1',
      '- Per-run: pass, fail, pass',
      '- Workflow run: https://github.com/growilabs/growi/actions/runs/34867613127',
      '',
      '```',
      '- Failed: this line is part of the log excerpt, not a fixed field',
      '```',
    ].join('\n');
    expect(parse(body, CASE1_SHA)).toEqual({
      runs: 3,
      failed: 1,
      perRun: ['pass', 'fail', 'pass'],
      workflowRunUrl:
        'https://github.com/growilabs/growi/actions/runs/34867613127',
    });
  });

  it('returns null when a required field is missing', () => {
    const body = [
      '### Repro result',
      '',
      `- Commit: ${CASE1_SHA}`,
      '- Branch: flaky-repro/issue-11823-replace-procedure',
      '- Mode: file',
      '- Runs: 3',
      // no "- Failed:" line
      '- Per-run: pass, pass, pass',
      '- Workflow run: https://github.com/growilabs/growi/actions/runs/34867613127',
    ].join('\n');
    expect(parse(body, CASE1_SHA)).toBeNull();
  });
});

describe('repro-result.selectNewestMatch', () => {
  const olderComment = {
    id: 1,
    created_at: '2026-09-10T00:00:00Z',
    body: CASE1_BODY,
    html_url: 'https://github.com/growilabs/growi/issues/1#issuecomment-1',
  };
  const newerComment = {
    id: 2,
    created_at: '2026-09-11T00:00:00Z',
    body: CASE1_BODY,
    html_url: 'https://github.com/growilabs/growi/issues/1#issuecomment-2',
  };

  it('returns null when no comment carries a - Commit: line for sha', () => {
    expect(
      selectNewestMatch(
        [olderComment],
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      ),
    ).toBeNull();
  });

  it('picks the single match when only one comment carries the sha', () => {
    expect(selectNewestMatch([olderComment], CASE1_SHA)).toEqual({
      comment: olderComment,
      result: {
        runs: 3,
        failed: 0,
        perRun: ['pass', 'pass', 'pass'],
        workflowRunUrl:
          'https://github.com/growilabs/growi/actions/runs/34867613127',
      },
    });
  });

  it('picks the newer of two matching comments by created_at', () => {
    expect(selectNewestMatch([olderComment, newerComment], CASE1_SHA)).toEqual({
      comment: newerComment,
      result: expect.objectContaining({ runs: 3 }),
    });
    // Order of the input array must not matter.
    expect(selectNewestMatch([newerComment, olderComment], CASE1_SHA)).toEqual({
      comment: newerComment,
      result: expect.objectContaining({ runs: 3 }),
    });
  });

  it('throws instead of reporting a fabricated success when the ONLY match has a malformed created_at', () => {
    // `Array.prototype.reduce` with no seed never invokes the comparator
    // when the array has exactly one element, so a lone malformed candidate
    // used to sail through uncompared and come back as a normal match.
    const malformedComment = { ...olderComment, created_at: '2026-09-10' };
    expect(() => selectNewestMatch([malformedComment], CASE1_SHA)).toThrow(
      /not a fixed-width ISO-8601 UTC timestamp/,
    );
  });

  it('breaks an exact created_at tie by the larger id', () => {
    const tieA = {
      ...olderComment,
      id: 5,
      created_at: newerComment.created_at,
    };
    const tieB = {
      ...olderComment,
      id: 9,
      created_at: newerComment.created_at,
    };
    expect(selectNewestMatch([tieA, tieB], CASE1_SHA)?.comment.id).toBe(9);
    expect(selectNewestMatch([tieB, tieA], CASE1_SHA)?.comment.id).toBe(9);
  });
});
