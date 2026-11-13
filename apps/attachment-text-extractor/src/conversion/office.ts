import {
  type ConvertErrorCode,
  formatFromExtension,
  toMarkdownBytes,
} from '@firecrawl/anydoc';

import type { FailureKind } from '../contract';
import type { AnydocFormat } from '../formats/format-table';
import { ConversionError } from './conversion-error';

type Classified = readonly [kind: FailureKind, detail: string];

// null: codes this call never expects (needsOcr is for PDFs, io for file
// paths, hosted for OCR), so they are internal.
const FAILURE_BY_CODE: Readonly<Record<ConvertErrorCode, Classified | null>> = {
  encrypted: ['encrypted', 'document is encrypted'],
  resourceLimit: ['limit_exceeded', 'document exceeds a resource limit'],
  malformed: ['malformed', 'document is malformed'],
  missingPart: ['malformed', 'document is missing a required part'],
  unsupported: ['unsupported', 'document uses an unsupported variant'],
  needsOcr: null,
  io: null,
  hosted: null,
};

// anydoc messages may quote input bytes or archive member names, so only the
// limit's own identifier, e.g. "(max_xml_depth)", is carried into the detail.
const LIMIT_NAME = /\((max_[a-z_]+)\)/;

const isConvertErrorCode = (code: unknown): code is ConvertErrorCode =>
  typeof code === 'string' && Object.hasOwn(FAILURE_BY_CODE, code);

const codeOf = (thrown: unknown): ConvertErrorCode | null =>
  thrown instanceof Error && 'code' in thrown && isConvertErrorCode(thrown.code)
    ? thrown.code
    : null;

const unexpected = (thrown: unknown, code: ConvertErrorCode | null): string => {
  if (code != null) {
    return `unexpected ${code} error from anydoc`;
  }
  return thrown instanceof Error
    ? `unexpected ${thrown.name} from anydoc`
    : 'unexpected non-Error value from anydoc';
};

// The detail never quotes the thrown value's message: it ends up in logs and responses.
const classify = (thrown: unknown): ConversionError => {
  const code = codeOf(thrown);
  const classified = code == null ? null : FAILURE_BY_CODE[code];
  if (classified == null) {
    return new ConversionError('internal', unexpected(thrown, code));
  }
  const [kind, detail] = classified;
  const limitName =
    kind === 'limit_exceeded' && thrown instanceof Error
      ? LIMIT_NAME.exec(thrown.message)?.[1]
      : undefined;
  return new ConversionError(
    kind,
    limitName == null ? detail : `${detail}: ${limitName}`,
  );
};

/** Converts with an explicit format; rejects with a ConversionError whose detail holds no file content. */
export const convertOffice = async (
  bytes: Uint8Array,
  format: AnydocFormat,
): Promise<string> => {
  // Format is an ambient const enum, so the value is looked up at runtime.
  const anydocFormat = formatFromExtension(format);
  if (anydocFormat == null) {
    throw new ConversionError('internal', `anydoc has no format ${format}`);
  }
  try {
    // No options argument: any `ocr` other than the default can send the
    // document to a hosted service (Req 4.5).
    return await toMarkdownBytes(bytes, anydocFormat);
  } catch (thrown) {
    throw classify(thrown);
  }
};
