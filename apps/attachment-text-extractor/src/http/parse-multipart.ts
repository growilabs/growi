export { InvalidMultipart } from './header-params';

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

export const boundaryOf = (_contentType: string): string => {
  throw new Error('not implemented: http/parse-multipart.boundaryOf');
};

export const createMultipartParser = (_boundary: string): MultipartParser => {
  throw new Error(
    'not implemented: http/parse-multipart.createMultipartParser',
  );
};
