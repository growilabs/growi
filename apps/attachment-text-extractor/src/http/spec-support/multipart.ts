// Builds multipart/form-data bodies byte for byte, the way httpx (the Python
// tests' client) writes them, so the same request can go to either service.
// Imports nothing from src/: the black-box tests use it against Python too.

export const SPEC_BOUNDARY = 'spec-boundary-4f1c9e';

export interface FormPart {
  readonly name: string;
  /** null: a plain field without a file name. */
  readonly filename: string | null;
  readonly data: Uint8Array | string;
}

export const multipartContentType = (
  boundary: string = SPEC_BOUNDARY,
): string => `multipart/form-data; boundary=${boundary}`;

const partHead = (part: FormPart): string => {
  const disposition =
    part.filename === null
      ? `form-data; name="${part.name}"`
      : `form-data; name="${part.name}"; filename="${part.filename}"`;
  const type =
    part.filename === null ? '' : 'Content-Type: application/octet-stream\r\n';
  return `Content-Disposition: ${disposition}\r\n${type}\r\n`;
};

export const multipartBody = (
  parts: readonly FormPart[],
  boundary: string = SPEC_BOUNDARY,
): Buffer =>
  Buffer.concat([
    ...parts.flatMap((part) => [
      Buffer.from(`--${boundary}\r\n${partHead(part)}`, 'utf8'),
      Buffer.from(part.data),
      Buffer.from('\r\n', 'latin1'),
    ]),
    Buffer.from(`--${boundary}--\r\n`, 'latin1'),
  ]);

/** The `file` part and, when given, the `mimeType` field. */
export const uploadParts = (
  fileName: string,
  data: Uint8Array | string,
  mimeType?: string,
): FormPart[] => [
  { name: 'file', filename: fileName, data },
  ...(mimeType === undefined
    ? []
    : [{ name: 'mimeType', filename: null, data: mimeType }]),
];

/** The head of a body whose `file` part carries `fileName`, up to its content. */
export const fileHead = (
  fileName: string,
  boundary: string = SPEC_BOUNDARY,
): Buffer =>
  Buffer.from(
    `--${boundary}\r\n${partHead({ name: 'file', filename: fileName, data: '' })}`,
    'utf8',
  );

export const bodyTail = (boundary: string = SPEC_BOUNDARY): Buffer =>
  Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1');
