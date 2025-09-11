import type { ClientOptions as ES7ClientOptions } from '@elastic/elasticsearch7';
import type { ClientOptions as ES8ClientOptions } from '@elastic/elasticsearch8';
import type { ClientOptions as ES9ClientOptions } from '@elastic/elasticsearch9';

import { type ES7ClientDelegator } from './es7-client-delegator';
import { type ES8ClientDelegator } from './es8-client-delegator';
import { type ES9ClientDelegator } from './es9-client-delegator';
import type { ElasticsearchClientDelegator } from './interfaces';

type GetDelegatorOptions = {
  version: 7;
  options: ES7ClientOptions;
  rejectUnauthorized: boolean;
} | {
  version: 8;
  options: ES8ClientOptions;
  rejectUnauthorized: boolean;
} | {
  version: 9;
  options: ES9ClientOptions;
  rejectUnauthorized: boolean;
}

type IsAny<T> = 'dummy' extends (T & 'dummy') ? true : false;
type Delegator<Opts extends GetDelegatorOptions> =
  IsAny<Opts> extends true
    ? ElasticsearchClientDelegator
    : Opts extends { version: 7 }
      ? ES7ClientDelegator
      : Opts extends { version: 8 }
        ? ES8ClientDelegator
        : Opts extends { version: 9 }
          ? ES9ClientDelegator
          : ElasticsearchClientDelegator

let instance: ElasticsearchClientDelegator | null = null;
export const getClient = async<Opts extends GetDelegatorOptions>(opts: Opts): Promise<Delegator<Opts>> => {
  if (instance == null) {
    if (opts.version === 7) {
      await import('./es7-client-delegator').then(({ ES7ClientDelegator }) => {
        instance = new ES7ClientDelegator(opts.options, opts.rejectUnauthorized);
        return instance;
      });
    }
    if (opts.version === 8) {
      await import('./es8-client-delegator').then(({ ES8ClientDelegator }) => {
        instance = new ES8ClientDelegator(opts.options, opts.rejectUnauthorized);
        return instance;
      });
    }
    if (opts.version === 9) {
      await import('./es9-client-delegator').then(({ ES9ClientDelegator }) => {
        instance = new ES9ClientDelegator(opts.options, opts.rejectUnauthorized);
        return instance;
      });
    }
  }

  return instance as Delegator<Opts>;
};
