import { apiv3Put } from '~/client/util/apiv3-client';
import type {
  IApiv3PageUpdateParams,
  IApiv3PageUpdateResponse,
} from '~/interfaces/apiv3';

export const updatePage = async (
  params: IApiv3PageUpdateParams,
): Promise<IApiv3PageUpdateResponse> => {
  const res = await apiv3Put<IApiv3PageUpdateResponse>('/page', params);
  return res.data;
};
