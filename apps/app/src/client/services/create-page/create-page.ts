import { apiv3Post } from '~/client/util/apiv3-client';
import type {
  IApiv3PageCreateParams,
  IApiv3PageCreateResponse,
} from '~/interfaces/apiv3';

export const createPage = async (
  params: IApiv3PageCreateParams,
): Promise<IApiv3PageCreateResponse> => {
  const res = await apiv3Post<IApiv3PageCreateResponse>('/page', params);
  return res.data;
};
