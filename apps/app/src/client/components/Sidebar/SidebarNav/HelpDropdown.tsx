import type { FC } from 'react';
import { memo } from 'react';

import { useTranslation } from 'next-i18next';
import {
  UncontrolledDropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { useGrowiVersion } from '~/stores-universal/context';

import { SkeletonItem } from './SkeletonItem';


export const HelpDropdown: FC = memo(() => {
  const { t } = useTranslation('commons');
  const { data: growiVersion } = useGrowiVersion();

  if (growiVersion == null) {
    return <SkeletonItem />;
  }

  return (
    <UncontrolledDropdown direction="end">
      <DropdownToggle
        className="btn btn-primary d-flex align-items-center justify-content-center"
        data-testid="help-dropdown-button"
      >
        <span className="material-symbols-outlined">help</span>
      </DropdownToggle>

      <DropdownMenu
        container="body"
        data-testid="help-dropdown-menu"
        style={{ minWidth: '280px', fontSize: '14px' }}
      >
        <DropdownItem header className="fw-semibold pt-3 pb-3" style={{ fontSize: '16px' }}>
          {t('Help')}
        </DropdownItem>

        <DropdownItem divider />

        <DropdownItem
          tag="a"
          href="https://docs.growi.org"
          target="_blank"
          rel="noopener noreferrer"
          className="my-1"
          data-testid="growi-docs-link"
        >
          <span className="d-flex align-items-center">
            <span className="flex-grow-1">GROWI Docs</span>
            <span className="material-symbols-outlined ms-1 fs-6 opacity-50">open_in_new</span>
          </span>
        </DropdownItem>

        <DropdownItem
          tag="a"
          href="https://growi.cloud/help/"
          target="_blank"
          rel="noopener noreferrer"
          className="my-1"
          data-testid="growi-cloud-help-link"
        >
          <span className="d-flex align-items-center">
            <span className="flex-grow-1">GROWI.cloud {t('Help')}</span>
            <span className="material-symbols-outlined ms-1 fs-6 opacity-50">open_in_new</span>
          </span>
        </DropdownItem>

        <DropdownItem divider className="my-2" />

        <DropdownItem header className="opacity-75" style={{ fontSize: '12px', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}>
          <span>
            <a href="https://growi.org" target="_blank" rel="noopener noreferrer" className="text-decoration-none">GROWI</a>
            {' '}
            {growiVersion}
          </span>
        </DropdownItem>
      </DropdownMenu>
    </UncontrolledDropdown>
  );
});
