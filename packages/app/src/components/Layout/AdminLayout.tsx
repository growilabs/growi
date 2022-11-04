import React, { ReactNode } from 'react';

import dynamic from 'next/dynamic';

import { GrowiNavbar } from '../Navbar/GrowiNavbar';

import { RawLayout } from './RawLayout';

import styles from './Admin.module.scss';

const HotkeysManager = dynamic(() => import('../Hotkeys/HotkeysManager'), { ssr: false });


type Props = {
  title?: string
  componentTitle?: string
  children?: ReactNode
}


const AdminLayout = ({
  children, title, componentTitle,
}: Props): JSX.Element => {

  const AdminNavigation = dynamic(() => import('~/components/Admin/Common/AdminNavigation'), { ssr: false });
  const SystemVersion = dynamic(() => import('../SystemVersion'), { ssr: false });

  return (
    <RawLayout title={title}>
      <div className={`admin-page ${styles['admin-page']}`}>
        <GrowiNavbar />

        <header className="py-0 container-fluid">
          <h1 className="title px-3">{componentTitle}</h1>
        </header>
        <div id="main" className="main">
          <div className="container-fluid">
            <div className="row">
              <div className="col-lg-3">
                <AdminNavigation />
              </div>
              <div className="col-lg-9">
                {children}
              </div>
            </div>
          </div>
        </div>

        <SystemVersion />
      </div>

      <HotkeysManager />

    </RawLayout>
  );
};

export default AdminLayout;
