// biome-ignore lint/style/noRestrictedImports: Type-only import from axios
import type { AxiosResponse } from 'axios';
import urljoin from 'url-join';

import { toArrayIfNot } from '~/utils/array-utils';
import axios from '~/utils/axios';
import loggerFactory from '~/utils/logger';

const apiv3Root = '/_api/v3';

const logger = loggerFactory('growi:apiv3');

const apiv3ErrorHandler = (_err: any): any[] => {
  const isAxiosErr = axios.isAxiosError(_err);

  // extract api errors from general 400 err
  const err = isAxiosErr ? _err.response?.data?.errors : _err;
  let errs = toArrayIfNot(err);

  // Fallback: when no structured apiv3 errors can be extracted
  // (network failure, request timeout, proxy/HTML error page, non-apiv3 endpoint),
  // surface the underlying error instead of an empty array. Otherwise callers that
  // do `toastError(err)` would silently show nothing, leaving the user unaware of
  // the failure (see #11281).
  if (errs.length === 0) {
    const fallback = isAxiosErr ? new Error(_err.message) : _err;
    errs = toArrayIfNot(fallback);
  }

  const errorInfo = isAxiosErr ? _err.response?.data?.info : undefined;

  for (const err of errs) {
    logger.error(err.message);
  }
  if (errorInfo != null) {
    logger.error('additional info:', errorInfo);
  }

  return errs;
};

export async function apiv3Request<T = any>(
  method: string,
  path: string,
  params: unknown,
): Promise<AxiosResponse<T>> {
  try {
    const res = await axios[method](urljoin(apiv3Root, path), params);
    return res;
  } catch (err) {
    const errors = apiv3ErrorHandler(err);
    throw errors;
  }
}

export async function apiv3Get<T = any>(
  path: string,
  params: unknown = {},
): Promise<AxiosResponse<T>> {
  return apiv3Request('get', path, { params });
}

export async function apiv3Post<T = any>(
  path: string,
  params: unknown = {},
): Promise<AxiosResponse<T>> {
  return apiv3Request('post', path, params);
}

export async function apiv3PostForm<T = any>(
  path: string,
  formData: FormData,
): Promise<AxiosResponse<T>> {
  return apiv3Request('postForm', path, formData);
}

export async function apiv3Put<T = any>(
  path: string,
  params: unknown = {},
): Promise<AxiosResponse<T>> {
  return apiv3Request('put', path, params);
}

export async function apiv3Delete<T = any>(
  path: string,
  params: unknown = {},
): Promise<AxiosResponse<T>> {
  return apiv3Request('delete', path, { params });
}
