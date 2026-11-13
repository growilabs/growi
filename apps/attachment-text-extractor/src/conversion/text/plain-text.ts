import { decodeText } from './charset';

/** Decoded text only: JSON, YAML and the like are never parsed. */
export const plainToText = (bytes: Uint8Array): string => decodeText(bytes);
