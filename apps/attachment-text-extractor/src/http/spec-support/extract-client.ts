import {
  type FormPart,
  multipartBody,
  multipartContentType,
  uploadParts,
} from './multipart';

// A small client for the service's routes over fetch. Imports nothing from
// src/: the black-box tests use it against the Python service too.

export interface Answer {
  readonly status: number;
  readonly text: string;
  readonly headers: Headers;
}

export interface ExtractedPage {
  readonly pageNumber: number | null;
  readonly label: string | null;
  readonly content: string;
}

export interface Extracted {
  readonly pages: readonly ExtractedPage[];
  readonly mimeType: string;
  readonly extractedCharacters: number;
}

export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  /** Every key of the body, to check that nothing else is in it. */
  readonly keys: readonly string[];
}

const answerOf = async (response: Response): Promise<Answer> => ({
  status: response.status,
  text: await response.text(),
  headers: response.headers,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPage = (value: unknown): value is ExtractedPage =>
  isRecord(value) &&
  (typeof value.pageNumber === 'number' || value.pageNumber === null) &&
  (typeof value.label === 'string' || value.label === null) &&
  typeof value.content === 'string';

/** `value` as a JSON object; fails the test when it is anything else. */
export const recordOf = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(
      `not a JSON object: ${JSON.stringify(value)?.slice(0, 200)}`,
    );
  }
  return value;
};

export const jsonOf = (answer: Answer): Record<string, unknown> =>
  recordOf(JSON.parse(answer.text));

/** The body of a 200 from POST /extract; fails the test on any other answer. */
export const extractedOf = (answer: Answer): Extracted => {
  if (answer.status !== 200) {
    throw new Error(
      `expected 200, got ${answer.status}: ${answer.text.slice(0, 300)}`,
    );
  }
  const body = jsonOf(answer);
  const { pages, mimeType, extractedCharacters } = body;
  if (
    !Array.isArray(pages) ||
    !pages.every(isPage) ||
    typeof mimeType !== 'string' ||
    typeof extractedCharacters !== 'number'
  ) {
    throw new Error(`not an ExtractResponse: ${answer.text.slice(0, 300)}`);
  }
  return { pages, mimeType, extractedCharacters };
};

/** The body of an error answer: `code`, `message` and the keys it has. */
export const errorOf = (answer: Answer): ErrorBody => {
  const body = jsonOf(answer);
  return {
    code: typeof body.code === 'string' ? body.code : '',
    message: typeof body.message === 'string' ? body.message : '',
    keys: Object.keys(body).sort(),
  };
};

export const allContent = (extracted: Extracted): string =>
  extracted.pages.map((page) => page.content).join('\n');

/** Unicode code points, as Python's len() counts them. */
export const codePoints = (text: string): number => [...text].length;

export interface PostOptions {
  /** null sends no Authorization header. */
  readonly token: string | null;
  readonly authorization?: string;
  readonly signal?: AbortSignal;
}

export const postBody = async (
  baseUrl: string,
  body: Uint8Array | string,
  contentType: string,
  options: PostOptions,
): Promise<Answer> => {
  const headers: Record<string, string> = { 'content-type': contentType };
  const authorization =
    options.authorization ??
    (options.token === null ? undefined : `Bearer ${options.token}`);
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return answerOf(
    await fetch(`${baseUrl}/extract`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : new Uint8Array(body),
      signal: options.signal,
    }),
  );
};

export const postParts = (
  baseUrl: string,
  parts: readonly FormPart[],
  options: PostOptions,
): Promise<Answer> =>
  postBody(baseUrl, multipartBody(parts), multipartContentType(), options);

/** POST /extract with a `file` part and, when given, a `mimeType` field. */
export const postFile = (
  baseUrl: string,
  fileName: string,
  data: Uint8Array | string,
  options: PostOptions & { readonly mimeType?: string },
): Promise<Answer> =>
  postParts(baseUrl, uploadParts(fileName, data, options.mimeType), options);

export const getPath = async (
  baseUrl: string,
  path: string,
  token: string | null = null,
): Promise<Answer> =>
  answerOf(
    await fetch(`${baseUrl}${path}`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      redirect: 'manual',
    }),
  );

/** Any method on any path, for the authentication table. */
export const callPath = async (
  baseUrl: string,
  method: string,
  path: string,
  token: string | null,
): Promise<Answer> =>
  answerOf(
    await fetch(`${baseUrl}${path}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      redirect: 'manual',
    }),
  );
