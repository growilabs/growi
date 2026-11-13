import { isUtf8 } from 'node:buffer';

import { InvalidMultipart, parseHeaderParams } from './header-params';
import { createPart, type MultipartPart, PART_LIMITS } from './multipart-part';

// One synchronous, incremental multipart/form-data parser for POST /extract.
// Grammar and limits follow python-multipart 0.0.27 as Starlette 1.0.0 drives
// it (extract_upload.py; research.md 16.1 2). Every malformed body throws
// InvalidMultipart from write() or end(); nothing is asynchronous, so there
// is no 'error' event to miss.

export { InvalidMultipart };

export interface MultipartUpload {
  readonly chunks: readonly Buffer[];
  readonly size: number;
  readonly filename: string;
  readonly mimeHint: string | null;
}

/** Every malformed body throws InvalidMultipart from write() or end(). */
export interface MultipartParser {
  write(chunk: Buffer): void;
  end(): MultipartUpload;
}

const CR = 0x0d;
const LF = 0x0a;
const HYPHEN = 0x2d;
const COLON = 0x3a;
const SPACE = 0x20;
const TOKEN = new Uint8Array(256);
for (const c of Buffer.from(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'*+-.^_`|~",
)) {
  TOKEN[c] = 1;
}

/** Starlette's _user_safe_decode with its utf-8 default: utf-8 if valid, else latin-1. */
const decodeName = (latin1: string): string => {
  const b = Buffer.from(latin1, 'latin1');
  return isUtf8(b) ? b.toString('utf8') : latin1;
};

/** The boundary of a multipart/form-data request; the type is compared byte for byte, as Python does. */
export const boundaryOf = (contentType: string): string => {
  const { type, params } = parseHeaderParams(contentType);
  const boundary = params.boundary;
  if (type !== 'multipart/form-data' || boundary === undefined) {
    throw new InvalidMultipart('not multipart/form-data');
  }
  return boundary;
};

// A declaration, not an arrow: only then does `never` narrow at the call site
function fail(why: string): never {
  throw new InvalidMultipart(why);
}

type State =
  | 'start'
  | 'skip'
  | 'opening'
  | 'openingEnd'
  | 'openingLF'
  | 'emptyClose'
  | 'headerStart'
  | 'headerName'
  | 'valueStart'
  | 'value'
  | 'valueLF'
  | 'headersLF'
  | 'data'
  | 'afterDelim'
  | 'afterDelimLF'
  | 'afterDelimDash'
  | 'epilogue';

// A step reads from `pos` and returns where it stopped; DONE means the rest of
// the chunk is consumed (or must wait for the next one).
const DONE = -1;

class Parser implements MultipartParser {
  private readonly opening: Buffer;
  private readonly delim: Buffer;
  private state: State = 'start';
  private idx = 0;
  private matched = 0;
  private headerCount = 0;
  private headerSize = 0;
  private headerName = '';
  private headerValue = '';
  private disposition: string | null = null;
  private part: MultipartPart | null = null;
  private files = 0;
  private fields = 0;
  // Starlette's FormData.get(): the last completed part of that name wins
  private file: MultipartPart | null = null;
  private hint: MultipartPart | null = null;

  constructor(boundary: string) {
    // A carried-over delimiter match may only start at the last CR, so a
    // boundary must not hold one (LF is fine; research.md 7.5 2)
    if (boundary.includes('\r')) fail('CR in boundary');
    this.opening = Buffer.from(`--${boundary}`, 'latin1');
    this.delim = Buffer.from(`\r\n--${boundary}`, 'latin1');
  }

  write(chunk: Buffer): void {
    let pos = 0;
    while (pos < chunk.length) {
      pos = this.step(chunk, pos);
      if (pos === DONE) return;
    }
  }

  // Like Starlette, only completed parts count: a body cut after the file
  // part has ended still yields it
  end(): MultipartUpload {
    const file = this.file;
    const hint = this.hint;
    if (file === null || file.kind !== 'file') fail('no file part');
    if (hint !== null && hint.kind !== 'field') fail('mimeType sent as a file');
    const mimeHint =
      hint === null
        ? null
        : decodeName(Buffer.concat(hint.chunks).toString('latin1'));
    return {
      chunks: file.chunks,
      size: file.size,
      filename: file.filename ?? '',
      mimeHint: mimeHint === '' ? null : mimeHint,
    };
  }

  private step(chunk: Buffer, pos: number): number {
    switch (this.state) {
      case 'start':
      case 'skip':
      case 'opening':
      case 'openingEnd':
      case 'openingLF':
      case 'emptyClose':
        return this.preamble(chunk, pos);
      case 'headerStart':
      case 'headerName':
      case 'valueStart':
      case 'value':
      case 'valueLF':
      case 'headersLF':
        return this.headers(chunk, pos);
      case 'data':
        return this.data(chunk, pos);
      case 'afterDelim':
      case 'afterDelimLF':
      case 'afterDelimDash':
        return this.afterDelimiter(chunk, pos);
      case 'epilogue':
        return DONE; // ignored, as python-multipart does
    }
  }

  // Leading CR/LF: skip to the first '-' (python-multipart does it within one
  // chunk only; here it is independent of how the body is split)
  private preamble(chunk: Buffer, pos: number): number {
    switch (this.state) {
      case 'start':
        this.state =
          chunk[pos] === CR || chunk[pos] === LF ? 'skip' : 'opening';
        return this.state === 'skip' ? pos + 1 : pos;
      case 'skip': {
        const h = chunk.indexOf(HYPHEN, pos);
        if (h === -1) return DONE;
        this.state = 'opening';
        return h;
      }
      case 'opening':
        if (chunk[pos] !== this.opening[this.idx++])
          fail('no opening boundary');
        if (this.idx === this.opening.length) this.state = 'openingEnd';
        return pos + 1;
      case 'openingEnd':
        if (chunk[pos] === CR) this.state = 'openingLF';
        else if (chunk[pos] === HYPHEN) this.state = 'emptyClose';
        else fail('bad opening boundary');
        return pos + 1;
      case 'openingLF':
        if (chunk[pos] !== LF) fail('bad opening boundary');
        this.startPart();
        return pos + 1;
      default:
        if (chunk[pos] !== HYPHEN) fail('bad closing boundary');
        this.state = 'epilogue';
        return pos + 1;
    }
  }

  private headers(chunk: Buffer, pos: number): number {
    switch (this.state) {
      case 'headerStart':
        return this.headerStart(chunk, pos);
      case 'headerName':
        return this.headerNameByte(chunk[pos] ?? 0, pos);
      case 'valueStart':
        if (chunk[pos] !== SPACE) {
          this.state = 'value';
          return pos;
        }
        this.countHeaderBytes(1);
        return pos + 1;
      case 'value':
        return this.headerValueBytes(chunk, pos);
      case 'valueLF':
        if (chunk[pos] !== LF) fail('CR without LF in a part header');
        this.state = 'headerStart';
        return pos + 1;
      default:
        if (chunk[pos] !== LF) fail('bad end of part headers');
        this.headersDone();
        this.state = 'data';
        this.matched = 0;
        return pos + 1;
    }
  }

  private headerStart(chunk: Buffer, pos: number): number {
    if (chunk[pos] === CR) {
      this.state = 'headersLF';
      return pos + 1;
    }
    if (++this.headerCount > PART_LIMITS.maxHeaderCount) {
      fail('too many part headers');
    }
    this.headerSize = 0;
    this.headerName = '';
    this.headerValue = '';
    this.state = 'headerName';
    return pos;
  }

  private headerNameByte(c: number, pos: number): number {
    this.countHeaderBytes(1);
    if (c === COLON) {
      if (this.headerName === '') fail('empty header name');
      this.state = 'valueStart';
    } else if (TOKEN[c] === 1) {
      this.headerName += String.fromCharCode(c);
    } else {
      fail('bad header name');
    }
    return pos + 1;
  }

  private headerValueBytes(chunk: Buffer, pos: number): number {
    const e = chunk.indexOf(CR, pos);
    const end = e === -1 ? chunk.length : e;
    this.countHeaderBytes(end - pos);
    this.headerValue += chunk.toString('latin1', pos, end);
    if (e === -1) return end;
    if (this.headerName.toLowerCase() === 'content-disposition') {
      this.disposition = this.headerValue; // the last one wins
    }
    this.state = 'valueLF';
    return end + 1;
  }

  private countHeaderBytes(n: number): void {
    this.headerSize += n;
    if (this.headerSize > PART_LIMITS.maxHeaderSize) {
      fail('part header too long');
    }
  }

  private startPart(): void {
    this.state = 'headerStart';
    this.headerCount = 0;
    this.disposition = null;
  }

  private headersDone(): void {
    const p: Readonly<Record<string, string | undefined>> =
      this.disposition === null
        ? {}
        : parseHeaderParams(this.disposition).params;
    if (p.name === undefined) fail('part without a name');
    const name = decodeName(p.name);
    if (p.filename !== undefined) {
      if (++this.files > PART_LIMITS.maxFiles) fail('too many files');
      this.part = createPart(
        'file',
        name,
        decodeName(p.filename),
        name === 'file',
      );
    } else {
      if (++this.fields > PART_LIMITS.maxFields) fail('too many fields');
      this.part = createPart('field', name, null, name === 'mimeType');
    }
  }

  private currentPart(): MultipartPart {
    return this.part ?? fail('data outside a part');
  }

  private partEnd(): void {
    const part = this.currentPart();
    part.close();
    if (part.name === 'file') this.file = part;
    if (part.name === 'mimeType') this.hint = part;
    this.part = null;
  }

  private data(chunk: Buffer, from: number): number {
    const { delim } = this;
    const part = this.currentPart();
    let pos = from;
    // `matched` bytes of the delimiter ended the previous chunk. CR occurs only
    // at delim[0] (a boundary cannot hold CR), so on a mismatch those bytes
    // are data and matching restarts here.
    if (this.matched > 0) {
      while (
        pos < chunk.length &&
        this.matched < delim.length &&
        chunk[pos] === delim[this.matched]
      ) {
        pos++;
        this.matched++;
      }
      if (this.matched === delim.length) {
        this.matched = 0;
        this.state = 'afterDelim';
        return pos;
      }
      if (pos === chunk.length) return DONE;
      part.add(delim.subarray(0, this.matched));
      this.matched = 0;
    }
    const j = chunk.indexOf(delim, pos);
    if (j !== -1) {
      part.add(chunk.subarray(pos, j));
      this.state = 'afterDelim';
      return j + delim.length;
    }
    this.keepTail(chunk, pos, part);
    return DONE;
  }

  // Holds back a tail that may begin a delimiter: it can only start at the last CR
  private keepTail(chunk: Buffer, pos: number, part: MultipartPart): void {
    const { delim } = this;
    const cr = chunk.lastIndexOf(CR);
    const tail = chunk.length - cr;
    if (
      cr >= pos &&
      tail < delim.length &&
      chunk.subarray(cr).equals(delim.subarray(0, tail))
    ) {
      part.add(chunk.subarray(pos, cr));
      this.matched = tail;
    } else {
      part.add(chunk.subarray(pos));
    }
  }

  // "\r\n--boundary" followed by neither CRLF nor "--" is part data (python-multipart), not a delimiter
  private notADelimiter(consumed: string): void {
    this.currentPart().add(
      Buffer.concat([this.delim, Buffer.from(consumed, 'latin1')]),
    );
    this.state = 'data';
  }

  private afterDelimiter(chunk: Buffer, pos: number): number {
    const c = chunk[pos];
    switch (this.state) {
      case 'afterDelim':
        if (c === CR) this.state = 'afterDelimLF';
        else if (c === HYPHEN) this.state = 'afterDelimDash';
        else {
          this.notADelimiter('');
          return pos;
        }
        return pos + 1;
      case 'afterDelimLF':
        if (c !== LF) {
          this.notADelimiter('\r');
          return pos;
        }
        this.partEnd();
        this.startPart();
        return pos + 1;
      default:
        if (c !== HYPHEN) {
          this.notADelimiter('-');
          return pos;
        }
        this.partEnd();
        this.state = 'epilogue';
        return pos + 1;
    }
  }
}

export const createMultipartParser = (boundary: string): MultipartParser =>
  new Parser(boundary);
