import type { FC } from 'react';
import { memo } from 'react';

import { useTranslation } from 'next-i18next';
import {
  UncontrolledDropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { useGrowiVersion, useGrowiCloudUri } from '~/states/global';
import { useShortcutsModalActions } from '~/states/ui/modal/shortcuts';

import { SkeletonItem } from './SkeletonItem';

import styles from './HelpDropdown.module.scss';


export const HelpDropdown: FC = memo(() => {
  const { t } = useTranslation();
  const growiVersion = useGrowiVersion();
  const { open: openShortcutsModal } = useShortcutsModalActions();
  const growiCloudUri = useGrowiCloudUri();

  if (growiVersion == null) {
    return <SkeletonItem />;
  }

  // add classes to cmd-key by OS
  const platform = window.navigator.platform.toLowerCase();
  const isMac = (platform.indexOf('mac') > -1);
  const os = isMac ? 'mac' : 'win';

  // Cloud users see Help, others see Docs
  const isCloudUser = growiCloudUri != null;
  const helpUrl = isCloudUser ? 'https://growi.cloud/help/' : 'https://docs.growi.org';
  const helpLabel = isCloudUser ? t('Help') : 'GROWI Docs';

  return (
    <UncontrolledDropdown direction="end" className={styles['help-dropdown']}>
      <DropdownToggle
        className="btn btn-primary d-flex align-items-center justify-content-center"
        data-testid="help-dropdown-button"
      >
        <span className="material-symbols-outlined">help</span>
      </DropdownToggle>

      <DropdownMenu
        container="body"
        data-testid="help-dropdown-menu"
        className={styles['help-dropdown-menu']}
      >
        <DropdownItem header className="text-secondary py-1">
          {t('Help')}
        </DropdownItem>
        <DropdownItem
          tag="a"
          href={helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="my-1"
          data-testid="help-link"
        >
          <span className="d-flex align-items-center">
            {helpLabel}
            <span className="growi-custom-icons ms-1 small">external_link</span>
          </span>
        </DropdownItem>

        <DropdownItem
          className="my-1"
          onClick={() => openShortcutsModal()}
        >
          <span className="d-flex align-items-center">
            <span className="flex-grow-1">{t('help_dropdown.show_shortcuts')}</span>
            <span className="text-secondary">
              <span className={`cmd-key ${os}`} />&nbsp;+ /
            </span>
          </span>
        </DropdownItem>

        <DropdownItem divider className="my-2" />

        <DropdownItem header className="py-1">
          <span className="d-flex text-secondary">
            <span className="flex-grow-1"> {t('help_dropdown.growi_version')}</span>
            {growiVersion}
          </span>
        </DropdownItem>
      </DropdownMenu>
    </UncontrolledDropdown>
  );
});
