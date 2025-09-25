import {
  Catch,
  ExceptionFilterMethods,
  PlatformContext,
  PlatformResponse,
} from '@tsed/common';

import { CustomHttpError } from '~/models/errors';

@Catch(CustomHttpError)
export class CustomHttpErrorFilter implements ExceptionFilterMethods {
  async catch(
    exception: CustomHttpError,
    ctx: PlatformContext,
    // biome-ignore lint/suspicious/noExplicitAny: ignore
  ): Promise<PlatformResponse<any>> {
    const { httpError } = exception;
    const { response } = ctx;

    return response.status(httpError.status).body({
      status: httpError.status,
      message: httpError.message,
    });
  }
}
