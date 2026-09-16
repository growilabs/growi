import { describe, expect, it } from 'vitest';

import { parse } from './repro-result.ts';

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
