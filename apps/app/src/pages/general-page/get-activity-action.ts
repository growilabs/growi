import type {
  IDataWithMeta,
  IPageNotFoundInfo,
} from '@growi/core/dist/interfaces';
import { pagePathUtils } from '@growi/core/dist/utils';

import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';

import type { IPageToShowRevisionWithMeta } from './types';

export const getActivityAction = (props: {
  isNotCreatable: boolean;
  isForbidden: boolean;
  isNotFound: boolean;
  pageWithMeta?:
    | IPageToShowRevisionWithMeta
    | IDataWithMeta<null, IPageNotFoundInfo>
    | null;
}): SupportedActionType => {
  if (props.isNotCreatable) {
    return SupportedAction.ACTION_PAGE_NOT_CREATABLE;
  }
  if (props.isForbidden) {
    return SupportedAction.ACTION_PAGE_FORBIDDEN;
  }
  if (props.isNotFound) {
    return SupportedAction.ACTION_PAGE_NOT_FOUND;
  }

  // Type-safe access to page data - only access path if data is not null
  const pagePath = props.pageWithMeta?.data?.path ?? '';
  if (pagePathUtils.isUsersHomepage(pagePath)) {
    return SupportedAction.ACTION_PAGE_USER_HOME_VIEW;
  }
  return SupportedAction.ACTION_PAGE_VIEW;
};
