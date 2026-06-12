import type React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'next-i18next';

import { AdminPageFrame } from '~/pages/admin/_shared/AdminPageFrame.js';
import { useUnstatedContainers } from '~/pages/admin/_shared/use-unstated-container.js';
import { useCustomTitle } from '~/pages/utils/page-title-customization.js';

import type { AdminCommonProps, AnyUnstatedContainer } from './types.js';

export interface AdminLayoutOptions<P extends AdminCommonProps> {
  title: string | ((props: P, t: TFunction) => string);
  containerFactories?: Array<() => Promise<AnyUnstatedContainer>>;
}

export function createAdminPageLayout<P extends AdminCommonProps>(
  options: AdminLayoutOptions<P>,
) {
  return function getLayout(page: ReactElement<P>): ReactNode {
    const Wrapper: React.FC = () => {
      const { t } = useTranslation('admin');

      const rawTitle =
        typeof options.title === 'function'
          ? options.title(page.props, t)
          : options.title;
      const title = useCustomTitle(rawTitle);

      const factories = useMemo(() => options.containerFactories ?? [], []);
      const containers = useUnstatedContainers(factories);

      return (
        <AdminPageFrame
          title={title}
          componentTitle={rawTitle}
          isAccessDeniedForNonAdminUser={
            page.props.isAccessDeniedForNonAdminUser
          }
          containers={containers}
        >
          {page}
        </AdminPageFrame>
      );
    };
    return <Wrapper />;
  };
}

export default createAdminPageLayout;
