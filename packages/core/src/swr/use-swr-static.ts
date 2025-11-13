import {
  type Key,
  type SWRConfiguration,
  type SWRResponse,
  useSWRConfig,
} from 'swr';
import useSWRImmutable from 'swr/immutable';

export function useSWRStatic<Data, Error>(key: Key): SWRResponse<Data, Error>;
export function useSWRStatic<Data, Error>(
  key: Key,
  data: Data | undefined,
): SWRResponse<Data, Error>;
export function useSWRStatic<Data, Error>(
  key: Key,
  data: Data | undefined,
  configuration: SWRConfiguration<Data, Error> | undefined,
): SWRResponse<Data, Error>;

export function useSWRStatic<Data, Error>(
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

  if (configuration?.fetcher != null) {
    throw new Error("useSWRStatic does not support 'configuration.fetcher'");
  }

  const { cache } = useSWRConfig();
  const swrResponse = useSWRImmutable(key, null, {
    ...configuration,
    fallbackData:
      configuration?.fallbackData ??
      (key != null ? cache.get(key?.toString())?.data : undefined),
  });

  // update data
  if (key != null && data !== undefined) {
    swrResponse.mutate(data, { optimisticData: data });
  }

  return swrResponse;
}
