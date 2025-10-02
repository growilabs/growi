import ExtensibleCustomError from 'extensible-custom-error';
import { HttpError } from 'http-errors';

export class InvalidUrlError extends ExtensibleCustomError {
  constructor(url: string) {
    super(`Invalid URL: ${url}`);
  }
}

export class CustomHttpError extends Error {
  httpError: HttpError;

  constructor(httpError: HttpError) {
    super(httpError.message);
    this.httpError = httpError;
  }
}
