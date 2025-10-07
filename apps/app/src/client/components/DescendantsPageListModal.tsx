
import React, {
  useState, useMemo, useEffect, type JSX,
} from 'react';

import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import {
  Modal, ModalHeader, ModalBody,
} from 'reactstrap';

import { useIsSharedUser } from '~/states/context';
import { useDeviceLargerThanLg } from '~/states/ui/device';
import { useDescendantsPageListModalActions, useDescendantsPageListModalStatus } from '~/states/ui/modal/descendants-page-list';

import { CustomNavDropdown, CustomNavTab } from './CustomNavigation/CustomNav';
import CustomTabContent from './CustomNavigation/CustomTabContent';
import type { DescendantsPageListProps } from './DescendantsPageList';
import ExpandOrContractButton from './ExpandOrContractButton';

import styles from './DescendantsPageListModal.module.scss';

const DescendantsPageList = dynamic<DescendantsPageListProps>(() => import('./DescendantsPageList').then(mod => mod.DescendantsPageList), { ssr: false });

const PageTimeline = dynamic(() => import('./PageTimeline').then(mod => mod.PageTimeline), { ssr: false });

export const DescendantsPageListModal = (): JSX.Element => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('pagelist');
  const [isWindowExpanded, setIsWindowExpanded] = useState(false);

  const isSharedUser = useIsSharedUser();

  const status = useDescendantsPageListModalStatus();
  const { close } = useDescendantsPageListModalActions();

  const { events } = useRouter();

  const [isDeviceLargerThanLg] = useDeviceLargerThanLg();

  useEffect(() => {
    events.on('routeChangeStart', close);
    return () => {
      events.off('routeChangeStart', close);
    };
  }, [close, events]);

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: () => <span className="material-symbols-outlined">subject</span>,
        Content: () => {
          if (status == null || status.path == null || !status.isOpened) {
            return <></>;
          }
          return <DescendantsPageList path={status.path} />;
        },
        i18n: t('page_list'),
        isLinkEnabled: () => !isSharedUser,
      },
      timeline: {
        Icon: () => <span data-testid="timeline-tab-button" className="material-symbols-outlined">timeline</span>,
        Content: () => {
          if (status == null || !status.isOpened) {
            return <></>;
          }
          return <PageTimeline />;
        },
        i18n: t('Timeline View'),
        isLinkEnabled: () => !isSharedUser,
      },
    };
  }, [isSharedUser, status, t]);

  const buttons = useMemo(() => (
    <span className="me-3">
      <ExpandOrContractButton
        isWindowExpanded={isWindowExpanded}
        expandWindow={() => setIsWindowExpanded(true)}
        contractWindow={() => setIsWindowExpanded(false)}
      />
      <button type="button" className="btn btn-close ms-2" onClick={close} aria-label="Close"></button>
    </span>
  ), [close, isWindowExpanded]);

  if (status == null) {
    return <></>;
  }

  const { isOpened } = status;

  return (
    <Modal
      size="xl"
      isOpen={isOpened}
      toggle={close}
      data-testid="descendants-page-list-modal"
      className={`grw-descendants-page-list-modal ${styles['grw-descendants-page-list-modal']} ${isWindowExpanded ? 'grw-modal-expanded' : ''} `}
    >
      <ModalHeader className={isDeviceLargerThanLg ? 'p-0' : ''} toggle={close} close={buttons}>
        {isDeviceLargerThanLg && (
          <CustomNavTab
            activeTab={activeTab}
            navTabMapping={navTabMapping}
            breakpointToHideInactiveTabsDown="md"
            onNavSelected={v => setActiveTab(v)}
            hideBorderBottom
          />
        )}
      </ModalHeader>
      <ModalBody>
        {!isDeviceLargerThanLg && (
          <CustomNavDropdown
            activeTab={activeTab}
            navTabMapping={navTabMapping}
            onNavSelected={v => setActiveTab(v)}
          />
        )}
        <CustomTabContent
          activeTab={activeTab}
          navTabMapping={navTabMapping}
          additionalClassNames={!isDeviceLargerThanLg ? ['grw-tab-content-style-md-down'] : undefined}
        />
      </ModalBody>
    </Modal>
  );

};
