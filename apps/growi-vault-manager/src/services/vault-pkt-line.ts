/**
 * pkt-line helpers for the git smart HTTP request head.
 *
 * A `POST /internal/git/git-upload-pack` body starts with the client's want
 * section, encoded as pkt-lines (a 4-hex-digit length prefix that includes the
 * prefix itself, followed by the payload; `0000` is the flush packet):
 *
 *   0032want <oid>\n
 *   0032want <oid>\n
 *   0000
 *   0009done\n
 *
 * `parseWantSection` reads only up to the first flush packet, which is all the
 * guard in vault-want-guard.ts needs in order to decide whether the request may
 * reach upload-pack (requirement 5.4 / 5.6). Everything here is pure so the
 * parsing can be tested without a stream or a git process.
 *
 * Only protocol v0 is covered, which is the only version reachable today: the
 * gateway does not forward the client's `Git-Protocol` header, so upload-pack
 * never negotiates v2. A v2 body is reported as invalid rather than guessed at
 * — see the note on the same subject in the vault-manager research.md.
 */

/** Largest want section the parser will buffer before giving up (bytes). */
export const MAX_WANT_SECTION_BYTES = 64 * 1024;

/** Outcome of parsing the head of an upload-pack request body. */
export type WantSectionParseResult =
  /**
   * The flush packet was reached; `wants` lists every OID the client asked for
   * and `filters` every partial-clone filter spec it asked to be applied.
   */
  | {
      readonly status: 'complete';
      readonly wants: readonly string[];
      readonly filters: readonly string[];
    }
  /** More bytes are needed before the section can be judged. */
  | { readonly status: 'need-more' }
  /** The bytes cannot be a v0 want section; the request must not be forwarded. */
  | { readonly status: 'invalid'; readonly reason: string };

/** Matches a bare object name (sha1 or sha256), which is all a want may carry. */
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Length of a pkt-line length prefix, in bytes. */
const LENGTH_PREFIX_BYTES = 4;

/**
 * Encodes a payload as a single pkt-line.
 *
 * Used to build the `ERR` response the guard sends when it refuses a request,
 * so the git client reports a remote error instead of a broken stream.
 *
 * @param payload - Line content, including any trailing newline.
 * @returns The pkt-line, length prefix included.
 */
export function encodePktLine(payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  const length = body.length + LENGTH_PREFIX_BYTES;
  const prefix = Buffer.from(length.toString(16).padStart(4, '0'), 'ascii');
  return Buffer.concat([prefix, body]);
}

/**
 * Reads the want section at the head of an upload-pack request body.
 *
 * `want` and `filter` lines are collected because the guard decides on both.
 * Everything else (`shallow`, `deepen`, …) is skipped: those carry nothing to
 * authorise. No line is altered — the body is handed to upload-pack unchanged.
 *
 * @param buf - Bytes received so far, from the start of the request body.
 * @returns Whether the section is complete, and what it requests.
 */
export function parseWantSection(buf: Buffer): WantSectionParseResult {
  const wants: string[] = [];
  const filters: string[] = [];
  let offset = 0;

  for (;;) {
    if (offset > MAX_WANT_SECTION_BYTES) {
      return {
        status: 'invalid',
        reason: 'want section exceeds the size a git client would send',
      };
    }
    if (buf.length - offset < LENGTH_PREFIX_BYTES) {
      return { status: 'need-more' };
    }

    const lengthHex = buf
      .subarray(offset, offset + LENGTH_PREFIX_BYTES)
      .toString('ascii');
    if (!/^[0-9a-fA-F]{4}$/.test(lengthHex)) {
      return { status: 'invalid', reason: 'malformed pkt-line length prefix' };
    }

    const length = Number.parseInt(lengthHex, 16);

    // Flush packet: the want section ends here.
    if (length === 0) {
      return { status: 'complete', wants, filters };
    }
    // 0001 (delim) and 0002 (response-end) only appear in protocol v2.
    if (length < LENGTH_PREFIX_BYTES) {
      return {
        status: 'invalid',
        reason: `unsupported pkt-line ${lengthHex} (protocol v2 is not handled)`,
      };
    }
    if (buf.length - offset < length) {
      return { status: 'need-more' };
    }

    const line = buf
      .subarray(offset + LENGTH_PREFIX_BYTES, offset + length)
      .toString('utf8');

    if (line.startsWith('want ')) {
      // The first want also carries the capability list, space separated.
      const oid = line.slice('want '.length).split(' ')[0]?.trim() ?? '';
      if (!OID_PATTERN.test(oid)) {
        return {
          status: 'invalid',
          reason: 'want line carries no object name',
        };
      }
      wants.push(oid);
    } else if (line.startsWith('filter ')) {
      filters.push(line.slice('filter '.length).trim());
    }

    offset += length;
  }
}
