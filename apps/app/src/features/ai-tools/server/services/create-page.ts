import type { IUserHasId } from '@growi/core/dist/interfaces';
import {
  isCreatablePage,
  userHomepagePath,
} from '@growi/core/dist/utils/page-path-utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import { format } from 'date-fns/format';

import { getTranslation } from '~/server/service/i18next';

const normalizeAndValidatePath = (path: string): string => {
  const normalizedPath = normalizePath(path);
  if (!isCreatablePage(normalizedPath)) {
    throw new Error('The specified path is not creatable page path');
  }
  return normalizedPath;
};

const generateTodaysMemoPath = async (
  user: IUserHasId,
  todaysMemoTitle: string,
): Promise<string> => {
  const { t } = await getTranslation({ lang: user.lang, ns: 'commons' });
  const path = `${userHomepagePath(user)}/${t('create_page_dropdown.todays.memo')}/${format(new Date(), 'yyyy/MM/dd')}/${todaysMemoTitle}`;
  const normalizedPath = normalizeAndValidatePath(path);
  return normalizedPath;
};

const generatePathFromKeywords = (
  user: IUserHasId,
  pathHintKeywords: string[],
): Promise<string> => {
  // TODO: https://redmine.weseek.co.jp/issues/173810
  throw new Error(
    'Path determination based on keywords is not yet implemented',
  );
};

export const determinePath = async (
  user: IUserHasId,
  path?: string,
  todaysMemoTitle?: string,
  pathHintKeywords?: string[],
): Promise<string> => {
  if (path != null) {
    return normalizeAndValidatePath(path);
  }

  if (todaysMemoTitle != null) {
    return generateTodaysMemoPath(user, todaysMemoTitle);
  }

  if (pathHintKeywords != null && pathHintKeywords.length > 0) {
    return generatePathFromKeywords(user, pathHintKeywords);
  }

  throw new Error('Cannot determine page path');
};
