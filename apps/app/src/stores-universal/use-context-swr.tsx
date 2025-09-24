import { useSWRStatic } from '@growi/core/dist/swr';
import assert from 'assert';
import type { Key, SWRConfiguration, SWRResponse } from 'swr';

export function useContextSWR<Data, Error>(key: Key): SWRResponse<Data, Error>;
export function useContextSWR<Data, Error>(
  key: Key,
  data: Data | undefined,
): SWRResponse<Data, Error>;
export function useContextSWR<Data, Error>(
  key: Key,
  data: Data | undefined,
  configuration: SWRConfiguration<Data, Error> | undefined,
): SWRResponse<Data, Error>;

export function useContextSWR<Data, Error>(
  ...args:
    | readonly [Key]
    | readonly [Key, Data | undefined]
    | readonly [
        Key,
        Data | undefined,
        SWRConfiguration<Data, Error> | undefined,
      ]
): SWRResponse<Data, Error> {
  const [key, data, configuration] = args;

  assert.notStrictEqual(
    configuration?.fetcher,
    null,
    "useContextSWR does not support 'configuration.fetcher'",
  );

  const swrResponse = useSWRStatic(key, data, configuration);

  // overwrite mutate
  const result = Object.assign(swrResponse, {
    mutate: () => {
      throw Error('mutate can not be used in context');
    },
  });

  return result;
}
