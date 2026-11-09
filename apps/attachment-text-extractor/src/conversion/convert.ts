import type {
  ConversionLimits,
  ConversionOutcome,
  FailureKind,
} from '../contract';
import { resolveFormat } from '../formats/format-table';
import { checkInputSize } from '../formats/input-size';
import { assemblePages } from './assemble-pages';
import { ConversionError } from './conversion-error';
import { convertByRoute } from './route-converters';

const failed = (failure: FailureKind, detail: string): ConversionOutcome => ({
  kind: 'failed',
  failure,
  detail,
});

// Only the class name: a converter's message may quote input bytes.
const unexpected = (thrown: unknown): ConversionOutcome =>
  failed('internal', thrown instanceof Error ? thrown.name : 'non-Error value');

const convertResolved = async (
  bytes: Uint8Array,
  fileName: string,
  mimeHint: string | null,
  limits: ConversionLimits,
): Promise<ConversionOutcome> => {
  const format = resolveFormat(fileName, mimeHint);
  if (format == null) {
    return failed('unsupported', 'format is not supported');
  }
  const oversized = checkInputSize(format, bytes.byteLength, limits);
  if (oversized != null) {
    return failed(oversized.failure, oversized.detail);
  }
  const pages = await convertByRoute(bytes, format, limits);
  return {
    kind: 'ok',
    mimeType: format.mimeType,
    pages: assemblePages(pages, limits.maxResultBytes),
  };
};

/**
 * Format detection, input size check, the route's conversion, newline
 * normalization, empty-element removal and the result size check. Never
 * rejects: every failure, expected or not, comes back as an outcome whose
 * detail holds no file content.
 */
export const convert = async (
  bytes: Uint8Array,
  fileName: string,
  mimeHint: string | null,
  limits: ConversionLimits,
): Promise<ConversionOutcome> => {
  try {
    return await convertResolved(bytes, fileName, mimeHint, limits);
  } catch (thrown) {
    return thrown instanceof ConversionError
      ? failed(thrown.kind, thrown.detail)
      : unexpected(thrown);
  }
};
