import React, { type JSX, useCallback } from 'react';
import Link from 'next/link';
import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import urljoin from 'url-join';

import {
  useGrowiAppIdForGrowiCloud,
  useGrowiCloudUri,
} from '~/stores-universal/context';

import styles from './AdminNavigation.module.scss';

const moduleClass = styles['admin-navigation'];

// eslint-disable-next-line react/prop-types
const MenuLabel = ({ menu }: { menu: string }) => {
  const { t } = useTranslation(['admin', 'commons']);

  switch (menu) {
    /* eslint-disable no-multi-spaces, max-len */
    case 'app':
      return (
        <>
          <span className="material-symbols-outlined me-1">settings</span>
          {t('headers.app_settings', { ns: 'commons' })}
        </>
      );
    case 'security':
      return (
        <>
          <span className="material-symbols-outlined me-1">shield</span>
          {t('security_settings.security_settings')}
        </>
      );
    case 'markdown':
      return (
        <>
          <span className="material-symbols-outlined me-1">note</span>
          {t('markdown_settings.markdown_settings')}
        </>
      );
    case 'customize':
      return (
        <>
          <span className="material-symbols-outlined me-1">construction</span>
          {t('customize_settings.customize_settings')}
        </>
      );
    case 'importer':
      return (
        <>
          <span className="material-symbols-outlined me-1">cloud_upload</span>
          {t('importer_management.import_data')}
        </>
      );
    case 'export':
      return (
        <>
          <span className="material-symbols-outlined me-1">cloud_download</span>
          {t('export_management.export_archive_data')}
        </>
      );
    case 'data-transfer':
      return (
        <>
          <span className="material-symbols-outlined me-1">flight</span>
          {t('g2g_data_transfer.data_transfer', { ns: 'commons' })}
        </>
      );
    case 'notification':
      return (
        <>
          <span className="material-symbols-outlined me-1">notifications</span>
          {t('external_notification.external_notification')}
        </>
      );
    case 'slack-integration':
      return (
        <>
          <span className="material-symbols-outlined me-1">shuffle</span>
          {t('slack_integration.slack_integration')}
        </>
      );
    case 'slack-integration-legacy':
      return (
        <>
          <span className="material-symbols-outlined me-1">shuffle</span>
          {t('slack_integration_legacy.slack_integration_legacy')}
        </>
      );
    case 'users':
      return (
        <>
          <span className="material-symbols-outlined me-1">person</span>
          {t('user_management.user_management')}
        </>
      );
    case 'user-groups':
      return (
        <>
          <span className="material-symbols-outlined me-1">group</span>
          {t('user_group_management.user_group_management')}
        </>
      );
    case 'audit-log':
      return (
        <>
          <span className="material-symbols-outlined me-1">feed</span>
          {t('audit_log_management.audit_log')}
        </>
      );
    case 'plugins':
      return (
        <>
          <span className="material-symbols-outlined me-1">extension</span>
          {t('plugins.plugins')}
        </>
      );
    // Temporarily hiding
    // case 'ai-integration':           return (
    //   <>{/* TODO: unify sizing of growi-custom-icons so that simplify code -- 2024.10.09 Yuki Takei */}
    //     <span
    //       className="growi-custom-icons d-inline-block me-1"
    //       style={{
    //         fontSize: '18px', width: '24px', height: '24px', lineHeight: '24px', verticalAlign: 'bottom', paddingLeft: '2px',
    //       }}
    //     >
    //       growi_ai
    //     </span>
    //     {t('ai_integration.ai_integration')}
    //   </>
    // );
    case 'search':
      return (
        <>
          <span className="material-symbols-outlined me-1">search</span>
          {t('full_text_search_management.full_text_search_management')}
        </>
      );
    case 'cloud':
      return (
        <>
          <span className="material-symbols-outlined me-1">share</span>
          {t('cloud_setting_management.to_cloud_settings')}{' '}
        </>
      );
    default:
      return (
        <>
          <span className="material-symbols-outlined me-1">home</span>
          {t('wiki_management_homepage')}
        </>
      );
    /* eslint-enable no-multi-spaces, max-len */
  }
};

type MenuLinkProps = {
  menu: string;
  isListGroupItems: boolean;
  isRoot?: boolean;
  isActive?: boolean;
};

const MenuLink = ({
  menu,
  isRoot,
  isListGroupItems,
  isActive,
}: MenuLinkProps) => {
  const pageTransitionClassName = isListGroupItems
    ? 'list-group-item list-group-item-action rounded border-0'
    : 'dropdown-item px-3 py-2';

  const href = isRoot ? '/admin' : urljoin('/admin', menu);

  return (
    <Link
      href={href}
      className={`${pageTransitionClassName} ${isActive ? 'active' : ''}`}
    >
      <MenuLabel menu={menu} />
    </Link>
  );
};

export const AdminNavigation = (): JSX.Element => {
  const pathname = window.location.pathname;

  const { data: growiCloudUri } = useGrowiCloudUri();
  const { data: growiAppIdForGrowiCloud } = useGrowiAppIdForGrowiCloud();

  const isActiveMenu = useCallback(
    (path: string | string[]) => {
      const paths = Array.isArray(path) ? path : [path];

      return paths.some((path) => {
        const basisPath = pathUtils.normalizePath(urljoin('/admin', path));
        const basisParentPath = pathUtils.addTrailingSlash(basisPath);

        return pathname === basisPath || pathname.startsWith(basisParentPath);
      });
    },
    [pathname],
  );

  const getListGroupItemOrDropdownItemList = useCallback(
    (isListGroupItems: boolean) => {
      return (
        <>
          {/* eslint-disable no-multi-spaces */}
          <MenuLink
            menu="home"
            isListGroupItems={isListGroupItems}
            isActive={pathname === '/admin'}
            isRoot
          />
          <MenuLink
            menu="app"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/app')}
          />
          <MenuLink
            menu="security"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/security')}
          />
          <MenuLink
            menu="markdown"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/markdown')}
          />
          <MenuLink
            menu="customize"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/customize')}
          />
          <MenuLink
            menu="importer"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/importer')}
          />
          <MenuLink
            menu="export"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/export')}
          />
          <MenuLink
            menu="data-transfer"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/data-transfer')}
          />
          <MenuLink
            menu="notification"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu(['/notification', '/global-notification'])}
          />
          <MenuLink
            menu="slack-integration"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/slack-integration')}
          />
          <MenuLink
            menu="slack-integration-legacy"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/slack-integration-legacy')}
          />
          <MenuLink
            menu="users"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/users')}
          />
          <MenuLink
            menu="user-groups"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu(['/user-groups', 'user-group-detail'])}
          />
          <MenuLink
            menu="audit-log"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/audit-log')}
          />
          <MenuLink
            menu="plugins"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/plugins')}
          />
          {/* Temporarily hiding */}
          {/* <MenuLink menu="ai-integration" isListGroupItems={isListGroupItems} isActive={isActiveMenu('/aai-integration')} /> */}
          <MenuLink
            menu="search"
            isListGroupItems={isListGroupItems}
            isActive={isActiveMenu('/search')}
          />
          {growiCloudUri != null && growiAppIdForGrowiCloud != null && (
            <a
              href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}
              className="list-group-item list-group-item-action border-0 round-corner"
            >
              <MenuLabel menu="cloud" />
            </a>
          )}
          {/* eslint-enable no-multi-spaces */}
        </>
      );
    },
    [growiAppIdForGrowiCloud, growiCloudUri, isActiveMenu, pathname],
  );

  return (
    <React.Fragment>
      {/* List group */}
      <div className={`list-group ${moduleClass} sticky-top d-none d-lg-block`}>
        {getListGroupItemOrDropdownItemList(true)}
      </div>

      {/* Dropdown */}
      <div className="dropdown d-block d-lg-none mb-5">
        <button
          className="btn btn-outline-primary btn-lg dropdown-toggle col-12 text-end"
          type="button"
          id="dropdown-admin-navigation"
          data-display="static"
          data-bs-toggle="dropdown"
          aria-haspopup="true"
          aria-expanded="false"
        >
          <span className="float-start">
            {/* eslint-disable no-multi-spaces */}
            {pathname === '/admin' && <MenuLabel menu="home" />}
            {isActiveMenu('/app') && <MenuLabel menu="app" />}
            {isActiveMenu('/security') && <MenuLabel menu="security" />}
            {isActiveMenu('/markdown') && <MenuLabel menu="markdown" />}
            {isActiveMenu('/customize') && <MenuLabel menu="customize" />}
            {isActiveMenu('/importer') && <MenuLabel menu="importer" />}
            {isActiveMenu('/export') && <MenuLabel menu="export" />}
            {isActiveMenu(['/notification', '/global-notification']) && (
              <MenuLabel menu="notification" />
            )}
            {isActiveMenu('/slack-integration') && (
              <MenuLabel menu="slack-integration" />
            )}
            {isActiveMenu('/users') && <MenuLabel menu="users" />}
            {isActiveMenu(['/user-groups', 'user-group-detail']) && (
              <MenuLabel menu="user-groups" />
            )}
            {isActiveMenu('/search') && <MenuLabel menu="search" />}
            {isActiveMenu('/audit-log') && <MenuLabel menu="audit-log" />}
            {isActiveMenu('/plugins') && <MenuLabel menu="plugins" />}
            {isActiveMenu('/data-transfer') && (
              <MenuLabel menu="data-transfer" />
            )}
            {/* Temporarily hiding */}
            {/* {isActiveMenu('/ai-integration')                && <MenuLabel menu="ai-integration" />} */}
            {/* eslint-enable no-multi-spaces */}
          </span>
        </button>
        <div
          className="dropdown-menu"
          role="menu"
          aria-labelledby="dropdown-admin-navigation"
        >
          {getListGroupItemOrDropdownItemList(false)}
        </div>
      </div>
    </React.Fragment>
  );
};
