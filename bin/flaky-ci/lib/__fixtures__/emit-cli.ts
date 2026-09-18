// Test fixture, not a script entry point: `output.spec.ts` runs this in a real
// child process to prove the exit codes and the empty stdout of a failure,
// which cannot be observed from a pure formatter.
import { emit } from '../output.ts';

const mode = process.argv[2];

if (mode === 'success') {
  emit({ ok: true, facts: { runs: 20, failed: 3 } });
}

emit({ ok: false, failure: { reason: 'cannot read the issue body' } });
