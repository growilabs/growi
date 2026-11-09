import type { ConversionOutcome, FailureKind } from '../contract';
import {
  decodeResult,
  maxResultFrameBytes,
} from '../wire/length-prefixed-json';
import { encodeChildResult } from './child-result';

// Python test_child_entry.py's in-process cases (run_conversion): whatever the
// child sends must pass the parent's decoder, so the child itself turns what
// the wire cannot carry into a failure it may report. The other in-process
// cases (a ConversionError's kind and detail, unexpected errors becoming
// `internal` with the class name only) belong to convert() and are in
// conversion/convert.spec.ts.

const MIB = 1024 * 1024;

const decoded = (outcome: ConversionOutcome, maxResultBytes = 16 * MIB) =>
  decodeResult(encodeChildResult(outcome, maxResultBytes));

describe('encodeChildResult', () => {
  it('sends a success the parent decodes back unchanged', () => {
    const success: ConversionOutcome = {
      kind: 'ok',
      mimeType: 'application/pdf',
      pages: [
        { pageNumber: 1, label: '1', content: '情報システム' },
        { pageNumber: 2, label: '2', content: 'second' },
      ],
    };

    expect(decoded(success)).toEqual(success);
  });

  it('sends a failure as its kind and detail', () => {
    const failure: ConversionOutcome = {
      kind: 'failed',
      failure: 'encrypted',
      detail: 'document is password protected',
    };

    expect(decoded(failure)).toEqual(failure);
  });

  it.each<FailureKind>([
    'timeout',
    'crashed',
    'memory_exceeded',
  ])('reports the parent-only kind %s as internal', (kind) => {
    const outcome = decoded({ kind: 'failed', failure: kind, detail: 'x' });

    expect(outcome).toMatchObject({ kind: 'failed', failure: 'internal' });
  });

  it('cuts an overlong detail to what the parent accepts', () => {
    const detail = 'd'.repeat(5000);

    const outcome = decoded({ kind: 'failed', failure: 'malformed', detail });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.failure).toBe('malformed');
      expect(outcome.detail.length).toBeGreaterThan(0);
      expect(outcome.detail.length).toBeLessThan(detail.length);
      expect(detail.startsWith(outcome.detail)).toBe(true);
    }
  });

  it('reports text the wire cannot encode (a lone surrogate) as internal', () => {
    const outcome = decoded({
      kind: 'ok',
      mimeType: 'text/plain',
      pages: [{ pageNumber: null, label: null, content: 'a\ud800' }],
    });

    expect(outcome).toMatchObject({ kind: 'failed', failure: 'internal' });
  });

  it('reports a result frame over the ceiling as result_too_large', () => {
    // Control characters escape to 6 bytes each, so the frame outgrows the
    // ceiling while the text itself stays within max_result_bytes.
    const maxResultBytes = 1024;
    const content = '\x01'.repeat(
      Math.floor(maxResultFrameBytes(maxResultBytes) / 6) + 1,
    );

    const outcome = decoded(
      {
        kind: 'ok',
        mimeType: 'text/plain',
        pages: [{ pageNumber: null, label: null, content }],
      },
      maxResultBytes,
    );

    expect(outcome).toMatchObject({
      kind: 'failed',
      failure: 'result_too_large',
    });
  });

  it('keeps a result just under the ceiling', () => {
    const maxResultBytes = 1024;
    const content = 'a'.repeat(maxResultBytes);

    const outcome = decoded(
      {
        kind: 'ok',
        mimeType: 'text/plain',
        pages: [{ pageNumber: null, label: null, content }],
      },
      maxResultBytes,
    );

    expect(outcome).toMatchObject({ kind: 'ok' });
  });
});
