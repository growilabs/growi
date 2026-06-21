import type { RespondBodyForResponseUrl } from './response-url';

export interface IRespondUtil {
  respond(body: RespondBodyForResponseUrl): Promise<void>;
  respondInChannel(body: RespondBodyForResponseUrl): Promise<void>;
  replaceOriginal(body: RespondBodyForResponseUrl): Promise<void>;
  deleteOriginal(): Promise<void>;
}
