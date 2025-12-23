import React, {
  useMemo, useCallback, useState, type JSX,
} from 'react';

import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import {
  Modal, ModalBody, ModalHeader,
} from 'reactstrap';

import { useIsGuestUser, useIsReadOnlyUser, useIsSharedUser } from '~/states/context';
import { disableLinkSharingAtom } from '~/states/server-configurations';
import { useDeviceLargerThanLg } from '~/states/ui/device';
import { usePageAccessoriesModalStatus, usePageAccessoriesModalActions, PageAccessoriesModalContents } from '~/states/ui/modal/page-accessories';

import { CustomNavDropdown, CustomNavTab } from '../CustomNavigation/CustomNav';
import CustomTabContent from '../CustomNavigation/CustomTabContent';
import ExpandOrContractButton from '../ExpandOrContractButton';

import styles from './PageAccessoriesModal.module.scss';


const PageAttachment = dynamic(() => import('./PageAttachment'), { ssr: false });
const PageHistory = dynamic(() => import('./PageHistory').then(mod => mod.PageHistory), { ssr: false });
const ShareLink = dynamic(() => import('./ShareLink').then(mod => mod.ShareLink), { ssr: false });

interface PageAccessoriesModalSubstanceProps {
  isWindowExpanded: boolean;
  setIsWindowExpanded: (expanded: boolean) => void;
}

const PageAccessoriesModalSubstance = ({ isWindowExpanded, setIsWindowExpanded }: PageAccessoriesModalSubstanceProps): JSX.Element => {

  const { t } = useTranslation();

  const isSharedUser = useIsSharedUser();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isLinkSharingDisabled = useAtomValue(disableLinkSharingAtom);
  const [isDeviceLargerThanLg] = useDeviceLargerThanLg();

  const status = usePageAccessoriesModalStatus();
  const { close, selectContents } = usePageAccessoriesModalActions();

  // Memoize heavy navTabMapping calculation
  const navTabMapping = useMemo(() => {
    return {
      [PageAccessoriesModalContents.PageHistory]: {
        Icon: () => <span className="material-symbols-outlined">history</span>,
        Content: () => {
          return <PageHistory onClose={close} />;
        },
        i18n: t('History'),
        isLinkEnabled: () => !isGuestUser && !isSharedUser,
      },
      [PageAccessoriesModalContents.Attachment]: {
        Icon: () => <span className="material-symbols-outlined">attachment</span>,
        Content: () => {
          return <PageAttachment />;
        },
        i18n: t('attachment_data'),
      },
      [PageAccessoriesModalContents.ShareLink]: {
        Icon: () => <span className="material-symbols-outlined">share</span>,
        Content: () => {
          return <ShareLink />;
        },
        i18n: t('share_links.share_link_management'),
        isLinkEnabled: () => !isGuestUser && !isReadOnlyUser && !isSharedUser && !isLinkSharingDisabled,
      },
    };
  }, [t, close, isGuestUser, isReadOnlyUser, isSharedUser, isLinkSharingDisabled]);

  // Memoize expand/contract handlers
  const expandWindow = useCallback(() => setIsWindowExpanded(true), [setIsWindowExpanded]);
  const contractWindow = useCallback(() => setIsWindowExpanded(false), [setIsWindowExpanded]);

  const buttons = useMemo(() => (
    <span className="me-3">
      <ExpandOrContractButton
        isWindowExpanded={isWindowExpanded}
        expandWindow={expandWindow}
        contractWindow={contractWindow}
      />
      <button type="button" className="btn btn-close ms-2" onClick={close} aria-label="Close"></button>
    </span>
  ), [close, isWindowExpanded, expandWindow, contractWindow]);

  if (status == null || status.activatedContents == null) {
    return <></>;
  }

  return (
    <>
      <ModalHeader className={isDeviceLargerThanLg ? 'p-0' : ''} toggle={close} close={buttons}>
        {isDeviceLargerThanLg && (
          <CustomNavTab
            activeTab={status.activatedContents}
            navTabMapping={navTabMapping}
            breakpointToHideInactiveTabsDown="md"
            onNavSelected={selectContents}
            hideBorderBottom
          />
        )}
      </ModalHeader>
      <ModalBody className="overflow-auto grw-modal-body-style">
        {!isDeviceLargerThanLg && (
          <CustomNavDropdown
            activeTab={status.activatedContents}
            navTabMapping={navTabMapping}
            onNavSelected={selectContents}
          />
        )}
        <CustomTabContent
          activeTab={status.activatedContents}
          navTabMapping={navTabMapping}
          additionalClassNames={!isDeviceLargerThanLg ? ['grw-tab-content-style-md-down'] : undefined}
        />
      </ModalBody>
    </>
  );
};

export const PageAccessoriesModal = (): JSX.Element => {
  const status = usePageAccessoriesModalStatus();
  const { close } = usePageAccessoriesModalActions();
  const [isWindowExpanded, setIsWindowExpanded] = useState(false);

  if (status == null) {
    return <></>;
  }

  return (
    <Modal
      size="xl"
      isOpen={status.isOpened}
      toggle={close}
      data-testid="page-accessories-modal"
      className={`grw-page-accessories-modal ${styles['grw-page-accessories-modal']} ${isWindowExpanded ? 'grw-modal-expanded' : ''} `}
    >
      {status.isOpened && <PageAccessoriesModalSubstance isWindowExpanded={isWindowExpanded} setIsWindowExpanded={setIsWindowExpanded} />}
    </Modal>
  );
};
