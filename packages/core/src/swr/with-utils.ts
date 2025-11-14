import type { SWRResponse } from 'swr';

// biome-ignore lint/suspicious/noExplicitAny: ignore
export type SWRResponseWithUtils<U, D = any, E = any> = SWRResponse<D, E> & U;

// biome-ignore lint/suspicious/noExplicitAny: ignore
export const withUtils = <U, D = any, E = any>(
  response: SWRResponse<D, E>,
  utils: U,
): SWRResponseWithUtils<U, D, E> => {
  return Object.assign(response, utils);
};
