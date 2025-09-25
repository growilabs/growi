import { type JSX } from 'react';

import { pagePathUtils } from '@growi/core/dist/utils';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import {
  UncontrolledDropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/stores-universal/context';

import { SkeletonItem } from './SkeletonItem';

import styles from './PersonalDropdown.module.scss';

export const PersonalDropdown = (): JSX.Element => {
  const { t } = useTranslation('commons');
  const { data: currentUser } = useCurrentUser();

  if (currentUser == null) {
    return <SkeletonItem />;
  }

  const logoutHandler = async() => {
    try {
      await apiv3Post('/logout');
      window.location.reload();
    }
    catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <UncontrolledDropdown
        direction="end"
      >
        <DropdownToggle
          className={`btn btn-primary ${styles['btn-personal-dropdown']} opacity-100`}
          data-testid="personal-dropdown-button"
        >
          <UserPicture user={currentUser} noLink noTooltip />
        </DropdownToggle>

        <DropdownMenu
          container="body"
          data-testid="personal-dropdown-menu"
          className={styles['personal-dropdown-menu']}
        >
          <DropdownItem className={styles['personal-dropdown-header']} header>
            <div className="mt-2 mb-3">
              <UserPicture user={currentUser} size="lg" noLink noTooltip />
            </div>
            <div className="ms-1 fs-6">{currentUser.name}</div>
            <div className="d-flex align-items-center my-2">
              <small className="material-symbols-outlined me-1 pb-0 fs-6">person</small>
              <span>{currentUser.username}</span>
            </div>
            <div className="d-flex align-items-center">
              <span className="material-symbols-outlined me-1 pb-0 fs-6">mail</span>
              <span className="item-text-email">{currentUser.email}</span>
            </div>
          </DropdownItem>

          <DropdownItem className="my-3" divider />

          <Link
            href={pagePathUtils.userHomepagePath(currentUser)}
            data-testid="grw-personal-dropdown-menu-user-home"
          >
            <DropdownItem className={`my-1 ${styles['personal-dropdown-item']}`}>
              <span className="d-flex align-items-center">
                <span className="item-icon material-symbols-outlined me-2 pb-0 fs-6">home</span>
                <span className="item-text">{t('personal_dropdown.home')}</span>
              </span>
            </DropdownItem>
          </Link>

          <Link
            href="/me"
            data-testid="grw-personal-dropdown-menu-user-settings"
          >
            <DropdownItem className={`my-1 ${styles['personal-dropdown-item']}`}>
              <span className="d-flex align-items-center">
                <span className="item-icon material-symbols-outlined me-2 pb-0 fs-6">discover_tune</span>
                <span className="item-text">{t('personal_dropdown.settings')}</span>
              </span>
            </DropdownItem>
          </Link>

          <DropdownItem data-testid="logout-button" onClick={logoutHandler} className={`my-1 ${styles['personal-dropdown-item']}`}>
            <span className="d-flex align-items-center">
              <span className="item-icon material-symbols-outlined me-2 pb-0 fs-6">logout</span>
              <span className="item-text">{t('Sign out')}</span>
            </span>
          </DropdownItem>
        </DropdownMenu>
      </UncontrolledDropdown>
    </>
  );

};
