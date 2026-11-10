import { type ChildHeader, encodeChildHeader } from '../wire/child-header';
import { decodeResult } from '../wire/length-prefixed-json';
import {
  type DirectChild,
  endingWithin,
  spawnDirect,
} from './spec-support/direct-child';
import {
  ENTRY_LIMITS,
  entryHeader,
  entryInput,
  framed,
  INPUT_MARKER,
} from './spec-support/entry-input';

// The real child entry started directly, fed the two input frames the runner
// sends (header, then file), and read back on fd 3. child-entry.integ.ts holds
// the cases where the entry must refuse its input; these are the ones where it
// answers, and what it may print while doing so.

const CHILD_ENTRY = 'child/child-entry.ts';

const collect = (child: DirectChild, stream: 1 | 2): Promise<string> =>
  new Promise((resolve) => {
    let text = '';
    const source = child.process.stdio[stream];
    source?.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    source?.on('close', () => resolve(text));
  });

const answer = async (childHeader: ChildHeader, file: Uint8Array) => {
  const child = spawnDirect(CHILD_ENTRY);
  const logs = Promise.all([collect(child, 1), collect(child, 2)]);
  child.input.end(entryInput(childHeader, file));
  const ending = await endingWithin(child, 20_000);
  const result = await child.result;
  await child.dispose();
  return { ending, result, logs: (await logs).join('') };
};

/** The one frame on fd 3, which must be exactly four length bytes and that many bytes of body. */
const onlyFrame = (result: Buffer): Buffer => {
  expect(result.length).toBeGreaterThanOrEqual(4);
  expect(result.length).toBe(4 + result.readUInt32BE(0));
  return result.subarray(4);
};

describe.skipIf(process.platform !== 'linux')(
  'the child entry answering on fd 3',
  { timeout: 30_000 },
  () => {
    it('sends one result frame with the converted text and exits 0', async () => {
      const { ending, result } = await answer(
        entryHeader(),
        Buffer.from(`社内規程 ${INPUT_MARKER}\r\n第二行`),
      );

      expect(ending).toEqual({ code: 0, signal: null });
      expect(decodeResult(onlyFrame(result))).toEqual({
        kind: 'ok',
        mimeType: 'text/plain',
        pages: [
          {
            pageNumber: null,
            label: null,
            content: `社内規程 ${INPUT_MARKER}\n第二行`,
          },
        ],
      });
    });

    it('sends a failure kind without echoing the input', async () => {
      const { ending, result } = await answer(
        entryHeader({
          fileName: `${INPUT_MARKER}.unknown-ext`,
          mimeHint: null,
        }),
        Buffer.from(INPUT_MARKER),
      );

      expect(ending).toEqual({ code: 0, signal: null });
      const outcome = decodeResult(onlyFrame(result));
      expect(outcome).toMatchObject({ kind: 'failed', failure: 'unsupported' });
      expect(JSON.stringify(outcome)).not.toContain(INPUT_MARKER);
    });

    it('hands the header limits to the conversion', async () => {
      const { result } = await answer(
        entryHeader({ limits: { ...ENTRY_LIMITS, maxResultBytes: 8 } }),
        Buffer.from('a'.repeat(64)),
      );

      expect(decodeResult(onlyFrame(result))).toMatchObject({
        kind: 'failed',
        failure: 'result_too_large',
      });
    });

    it.each([
      [
        'a well-framed header that is not JSON',
        framed(Buffer.from(`{"${INPUT_MARKER}`)),
      ],
      [
        'a file frame over the header maxInputBytes',
        Buffer.concat([
          framed(encodeChildHeader(entryHeader({ maxInputBytes: 8 }))),
          framed(Buffer.from(`${INPUT_MARKER} is longer than eight bytes`)),
        ]),
      ],
    ])('sends no result for %s, and prints nothing from it', async (_id, input) => {
      const child = spawnDirect(CHILD_ENTRY);
      const logs = Promise.all([collect(child, 1), collect(child, 2)]);

      child.input.end(input);

      const ending = await endingWithin(child, 10_000);
      expect(ending).not.toBe('still running');
      expect(ending).not.toEqual({ code: 0, signal: null });
      expect(await child.result).toEqual(Buffer.alloc(0));
      await child.dispose();
      expect((await logs).join('')).not.toContain(INPUT_MARKER);
    });

    it('prints nothing from the input while converting', async () => {
      const { logs } = await answer(entryHeader(), Buffer.from(INPUT_MARKER));

      expect(logs).not.toContain(INPUT_MARKER);
    });
  },
);
