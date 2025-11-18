import {
  Catch,
  ExceptionFilterMethods,
  PlatformContext,
  PlatformResponse,
  ResourceNotFound,
} from '@tsed/common';

@Catch(ResourceNotFound)
export class ResourceNotFoundFilter implements ExceptionFilterMethods {
  async catch(
    exception: ResourceNotFound,
    ctx: PlatformContext,
    // biome-ignore lint/suspicious/noExplicitAny: ignore
  ): Promise<PlatformResponse<any>> {
    const { response } = ctx;

    const obj = {
      status: exception.status,
      message: exception.message,
      url: exception.url,
    };

    return response.status(exception.status).body(obj);
  }
}
