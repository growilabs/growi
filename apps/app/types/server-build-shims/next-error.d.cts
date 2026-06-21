// next/error runtime self-patches `module.exports` to the Error page component.

import type { ErrorProps as OrigErrorProps } from 'next/dist/api/error.js';
import OrigError from 'next/dist/api/error.js';

declare const NextError: typeof OrigError;
declare namespace NextError {
  type ErrorProps = OrigErrorProps;
}
export = NextError;
