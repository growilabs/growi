import React, { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useTranslation } from 'next-i18next';

import { useCustomTitle } from '~/pages/utils/page-title-customization';

import { AdminPageFrame } from './AdminPageFrame';
import type { AnyUnstatedContainer, AdminCommonProps } from './types';
import { useUnstatedContainers } from './use-unstated-container';

export interface AdminLayoutOptions<P extends AdminCommonProps> {
  title: string | ((props: P, t: (k: string) => string) => string);
  containerFactories?: Array<() => Promise<AnyUnstatedContainer>>;
}

export function createAdminPageLayout<P extends AdminCommonProps>(options: AdminLayoutOptions<P>) {
  return function getLayout(page: ReactElement<P>): ReactNode {
    const Wrapper: React.FC = () => {
      const { t } = useTranslation('admin');

      const rawTitle = typeof options.title === 'function' ? options.title(page.props, t) : options.title;
      const title = useCustomTitle(rawTitle);

      const factories = useMemo(() => options.containerFactories ?? [], []);
      const containers = useUnstatedContainers(factories);

      return (
        <AdminPageFrame
          title={title}
          componentTitle={rawTitle}
          isAccessDeniedForNonAdminUser={page.props.isAccessDeniedForNonAdminUser}
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
