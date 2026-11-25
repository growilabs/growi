import { NO_CHILD_WARNINGS } from '../wire/child-warning';
import { faultLine } from './diagnostics';
import { PROBE_INPUTS } from './probe-inputs';
import { probeConversions } from './readiness';
import { readReport } from './run-outcome';

// The two diagnostic cases no real child can be made to act out in a test: a
// child that survives its SIGKILL, and a probe whose shared time limit is used
// up before it starts. runner-diagnostics.integ.ts has every other line.

describe('a child that is still there after SIGKILL', () => {
  it('is an ERROR line, and the outcome stays what the parent decided', () => {
    const { outcome, fault } = readReport({
      ending: { kind: 'decided', decision: 'timeout' },
      peakRssKib: 0,
      warnings: NO_CHILD_WARNINGS,
      reaped: false,
    });

    expect(outcome).toMatchObject({ kind: 'failed', failure: 'timeout' });
    expect(fault === null ? null : faultLine(fault, 'prlimit')).toEqual({
      severity: 'ERROR',
      message: 'conversion child did not exit after SIGKILL',
    });
  });
});

describe('a probe that gets no time', () => {
  it('names the probe that could not start and starts no child for it', async () => {
    const convert = vi.fn();

    const reason = await probeConversions(convert, PROBE_INPUTS, 0);

    expect(reason).toBe('probe=pdf cause=time_limit');
    expect(convert).not.toHaveBeenCalled();
  });
});
