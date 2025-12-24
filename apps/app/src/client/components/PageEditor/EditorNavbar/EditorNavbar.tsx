import type { JSX } from 'react';

import { PageHeader } from '~/client/components/PageHeader';
import { useEditingClients } from '~/states/ui/editor/editing-clients';

import { EditingUserList } from './EditingUserList';

import styles from './EditorNavbar.module.scss';

const moduleClass = styles['editor-navbar'] ?? '';

const EditingUsers = (): JSX.Element => {
  const editingClients = useEditingClients();
  return (
    <EditingUserList
      clientList={editingClients}
    />
  );
};

export const EditorNavbar = (): JSX.Element => {
  return (
    <div className={`${moduleClass} d-flex flex-column flex-sm-row justify-content-between ps-3 ps-md-5 ps-xl-4 pe-4 py-1 align-items-sm-end`}>
      <div className="order-2 order-sm-1"><PageHeader /></div>
      <div className="order-1 order-sm-2"><EditingUsers /></div>
    </div>
  );
};
