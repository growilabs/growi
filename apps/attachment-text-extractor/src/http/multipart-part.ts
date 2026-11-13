import { InvalidMultipart } from './header-params';

// Starlette's defaults (extract_upload.py), as the Python service applied them.
export const PART_LIMITS = Object.freeze({
  maxHeaderSize: 4224,
  maxHeaderCount: 8,
  maxFields: 1000,
  maxFiles: 1,
  maxFieldSize: 1024 * 1024,
});

// Small chunks are copied into blocks: a body that arrives in tiny TCP pieces
// would otherwise be held as millions of small Buffers (research.md 16.6).
const BLOCK = 64 * 1024;
const SMALL_CHUNK = 16 * 1024;

export type PartKind = 'file' | 'field';

export interface MultipartPart {
  readonly kind: PartKind;
  readonly name: string;
  readonly filename: string | null;
  readonly chunks: readonly Buffer[];
  readonly size: number;
  add(bytes: Buffer): void;
  close(): void;
}

/** A part that keeps its bytes only when `keep` (the `file` and `mimeType` parts); any other is only counted. */
export const createPart = (
  kind: PartKind,
  name: string,
  filename: string | null,
  keep: boolean,
): MultipartPart => {
  const chunks: Buffer[] = [];
  let size = 0;
  let block: Buffer | null = null;
  let used = 0;
  const flush = (): void => {
    if (block !== null && used > 0) {
      chunks.push(
        used === BLOCK ? block : Buffer.from(block.subarray(0, used)),
      );
    }
    block = null;
    used = 0;
  };
  const keepBytes = (bytes: Buffer): void => {
    if (bytes.length >= SMALL_CHUNK) {
      flush();
      chunks.push(bytes);
      return;
    }
    if (block === null || used + bytes.length > BLOCK) {
      flush();
      block = Buffer.allocUnsafe(BLOCK);
    }
    bytes.copy(block, used);
    used += bytes.length;
  };
  return {
    kind,
    name,
    filename,
    chunks,
    get size() {
      return size;
    },
    add(bytes) {
      if (bytes.length === 0) return;
      size += bytes.length;
      if (kind === 'field' && size > PART_LIMITS.maxFieldSize) {
        throw new InvalidMultipart('field too large');
      }
      if (keep) keepBytes(bytes);
    },
    close: flush,
  };
};
