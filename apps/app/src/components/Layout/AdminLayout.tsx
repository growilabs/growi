import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import React from 'react';

import GrowiLogo from '~/components/Common/GrowiLogo';
import styles from './Admin.module.scss';
import { RawLayout } from './RawLayout';

const AdminNavigation = dynamic(
  () =>
    import('../Admin/Common/AdminNavigation').then(
      (mod) => mod.AdminNavigation,
    ),
  { ssr: false },
);
const PageCreateModal = dynamic(
  () => import('~/client/components/PageCreateModal'),
  { ssr: false },
);
const SystemVersion = dynamic(
  () => import('~/client/components/SystemVersion'),
  { ssr: false },
);
const HotkeysManager = dynamic(
  () => import('~/client/components/Hotkeys/HotkeysManager'),
  { ssr: false },
);

type Props = {
  componentTitle?: string;
  children?: ReactNode;
};

const AdminLayout = ({ children, componentTitle }: Props): JSX.Element => {
  return (
    <RawLayout>
      <div className={`admin-page ${styles['admin-page']}`}>
        <header className="py-0 container">
          <h1 className="p-3 fs-2 d-flex align-items-center">
            <Link href="/" className="d-block mb-1 me-2">
              <GrowiLogo />
            </Link>
            {componentTitle}
          </h1>
        </header>
        <div className="main">
          <div className="container">
            <div className="row">
              <div className="col-lg-3">
                <AdminNavigation />
              </div>
              <div className="col-lg-9 mb-5">{children}</div>
            </div>
          </div>
        </div>

        <PageCreateModal />
        <SystemVersion />
      </div>

      <HotkeysManager />
    </RawLayout>
  );
};

export default AdminLayout;
