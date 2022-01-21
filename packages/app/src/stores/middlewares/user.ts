import { apiv3Put } from '~/client/util/apiv3-client';

export const checkAndUpdateImageUrlCached = (useSWRNext) => {
  return (key, fetcher, config) => {
    const swrNext = useSWRNext(key, fetcher, config);
    if (swrNext.data != null) {
      const userIds = swrNext.data?.map(user => user._id);
      if (userIds.length > 0) {
        const distinctUserIds = Array.from(new Set(userIds));
        apiv3Put('/users/update.imageUrlCache', { userIds: distinctUserIds });
      }
    }
    return swrNext;
  };
};
