import type { JSX } from 'react';
import React from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { Provider } from 'unstated';

import type { AdminPageFrameProps } from './types';

// Dynamic imports to avoid SSR issues with admin-only components
const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const ForbiddenPage = dynamic(
  () =>
    import('~/client/components/Admin/ForbiddenPage').then(
      (mod) => mod.ForbiddenPage,
    ),
  { ssr: false },
);

/**
 * Admin page frame that centralizes:
 *  - Forbidden guard
 *  - AdminLayout wrapping
 *  - <Head><title /></Head>
 *  - Unstated Provider injection
 */
export const AdminPageFrame = ({
  title,
  componentTitle,
  isAccessDeniedForNonAdminUser,
  containers,
  children,
}: AdminPageFrameProps): JSX.Element => {
  if (isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <Provider inject={containers ?? []}>
      <AdminLayout componentTitle={componentTitle ?? title}>
        <Head>
          <title>{title}</title>
        </Head>
        {children}
      </AdminLayout>
    </Provider>
  );
};

export default AdminPageFrame;
