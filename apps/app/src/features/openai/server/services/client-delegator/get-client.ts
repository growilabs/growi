import { OpenaiServiceType } from '../../../interfaces/ai';

import { AzureOpenaiClientDelegator } from './azure-openai-client-delegator';
import type { IOpenaiClientDelegator } from './interfaces';
import { OpenaiClientDelegator } from './openai-client-delegator';

type GetDelegatorOptions = {
  openaiServiceType: OpenaiServiceType;
};

type IsAny<T> = 'dummy' extends T & 'dummy' ? true : false;
type Delegator<Opts extends GetDelegatorOptions> = IsAny<Opts> extends true
  ? IOpenaiClientDelegator
  : Opts extends { openaiServiceType: 'openai' }
    ? OpenaiClientDelegator
    : Opts extends { openaiServiceType: 'azure-openai' }
      ? AzureOpenaiClientDelegator
      : IOpenaiClientDelegator;

// biome-ignore lint/suspicious/noImplicitAnyLet: ignore
let instance;

export const getClient = <Opts extends GetDelegatorOptions>(
  opts: Opts,
): Delegator<Opts> => {
  // instanciate the client based on the service type
  if (instance == null) {
    if (opts.openaiServiceType === OpenaiServiceType.AZURE_OPENAI) {
      instance = new AzureOpenaiClientDelegator();
      return instance;
    }
    instance = new OpenaiClientDelegator();
  }

  return instance;
};
