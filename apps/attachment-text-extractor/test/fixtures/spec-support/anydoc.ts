import { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc';

/**
 * Converts with anydoc under an explicit format named by its extension, as the
 * service does. `Format` is an ambient const enum, so it is resolved at runtime.
 */
export const anydocMarkdown = async (
  bytes: Uint8Array,
  extension: string,
): Promise<string> => {
  const format = formatFromExtension(extension);
  if (format == null) {
    throw new Error(`anydoc has no format for extension: ${extension}`);
  }
  return await toMarkdownBytes(bytes, format);
};

/** The anydoc `ConvertErrorCode` a conversion rejects with. */
export const anydocErrorCode = async (
  bytes: Uint8Array,
  extension: string,
): Promise<string> => {
  try {
    await anydocMarkdown(bytes, extension);
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return String(error.code);
    }
    throw error;
  }
  throw new Error('anydoc converted the document without an error');
};
