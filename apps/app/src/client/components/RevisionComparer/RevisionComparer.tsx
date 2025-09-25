import React, { useState, type JSX } from 'react';

import type { IRevisionHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import {
  Dropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { RevisionDiff } from '../PageHistory/RevisionDiff';

import styles from './RevisionComparer.module.scss';

const { encodeSpaces } = pagePathUtils;

const DropdownItemContents = ({ title, contents }) => (
  <>
    <div className="h6 mt-1 mb-2"><strong>{title}</strong></div>
    <div className="card mb-1 p-2">{contents}</div>
  </>
);

type RevisionComparerProps = {
  sourceRevision: IRevisionHasId
  targetRevision: IRevisionHasId
  currentPageId?: string
  currentPagePath: string
  onClose: () => void
}

export const RevisionComparer = (props: RevisionComparerProps): JSX.Element => {
  const { t } = useTranslation(['translation', 'commons']);

  const {
    sourceRevision, targetRevision, onClose, currentPageId, currentPagePath,
  } = props;

  const [dropdownOpen, setDropdownOpen] = useState(false);


  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen);
  };

  const generateURL = (pathName: string) => {
    const { origin } = window.location;

    const url = new URL(pathName, origin);

    if (sourceRevision != null && targetRevision != null) {
      const urlParams = `${sourceRevision._id}...${targetRevision._id}`;
      url.searchParams.set('compare', urlParams);
    }

    return encodeSpaces(decodeURI(url.href));
  };

  const isNodiff = (sourceRevision == null || targetRevision == null) ? true : sourceRevision._id === targetRevision._id;

  if (currentPageId == null || currentPagePath == null) {
    return <>{ t('not_found_page.page_not_exist')}</>;
  }

  return (
    <div className={`${styles['revision-compare']} revision-compare`}>
      <div className="d-flex">
        <h4 className="align-self-center">{ t('page_history.comparing_revisions') }</h4>

        { !isNodiff && (
          <Dropdown
            className="grw-copy-dropdown align-self-center ms-auto"
            isOpen={dropdownOpen}
            toggle={() => toggleDropdown()}
          >
            <DropdownToggle className="btn-copy">
              <span className="material-symbols-outlined">content_paste</span>
            </DropdownToggle>
            <DropdownMenu strategy="fixed" end>
              {/* Page path URL */}
              <CopyToClipboard text={generateURL(currentPagePath)}>
                <DropdownItem className="px-3">
                  <DropdownItemContents title={t('copy_to_clipboard.Page URL', { ns: 'commons' })} contents={generateURL(currentPagePath)} />
                </DropdownItem>
              </CopyToClipboard>
              {/* Permanent Link URL */}
              <CopyToClipboard text={generateURL(currentPageId)}>
                <DropdownItem className="px-3">
                  <DropdownItemContents title={t('copy_to_clipboard.Permanent link', { ns: 'commons' })} contents={generateURL(currentPageId)} />
                </DropdownItem>
              </CopyToClipboard>
              <DropdownItem divider className="my-0"></DropdownItem>
            </DropdownMenu>
          </Dropdown>
        ) }
      </div>

      <div className={`revision-compare-container ${isNodiff ? 'nodiff' : ''}`}>
        { isNodiff
          ? (
            <span className="h3 text-muted">{t('No diff')}</span>
          )
          : (
            <RevisionDiff
              revisionDiffOpened
              previousRevision={sourceRevision}
              currentRevision={targetRevision}
              currentPageId={currentPageId}
              currentPagePath={currentPagePath}
              onClose={onClose}
            />
          )
        }
      </div>
    </div>
  );
};
