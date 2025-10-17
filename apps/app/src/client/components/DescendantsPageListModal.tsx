
import React, {
  useState, useMemo, useEffect, useCallback,
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

/**
 * DescendantsPageListModalSubstance - Presentation component (all logic here)
 */
type DescendantsPageListModalSubstanceProps = {
  path: string | undefined;
  closeModal: () => void;
  onExpandedChange?: (isExpanded: boolean) => void;
};

const DescendantsPageListModalSubstance = ({
  path,
  closeModal,
  onExpandedChange,
}: DescendantsPageListModalSubstanceProps): React.JSX.Element => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('pagelist');
  const [isWindowExpanded, setIsWindowExpanded] = useState(false);

  const isSharedUser = useIsSharedUser();
  const { events } = useRouter();
  const [isDeviceLargerThanLg] = useDeviceLargerThanLg();

  useEffect(() => {
    events.on('routeChangeStart', closeModal);
    return () => {
      events.off('routeChangeStart', closeModal);
    };
  }, [closeModal, events]);

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: () => <span className="material-symbols-outlined">subject</span>,
        Content: () => {
          if (path == null) {
            return <></>;
          }
          return <DescendantsPageList path={path} />;
        },
        i18n: t('page_list'),
        isLinkEnabled: () => !isSharedUser,
      },
      timeline: {
        Icon: () => <span data-testid="timeline-tab-button" className="material-symbols-outlined">timeline</span>,
        Content: () => {
          return <PageTimeline />;
        },
        i18n: t('Timeline View'),
        isLinkEnabled: () => !isSharedUser,
      },
    };
  }, [isSharedUser, path, t]);

  // Memoize event handlers
  const expandWindow = useCallback(() => {
    setIsWindowExpanded(true);
    onExpandedChange?.(true);
  }, [onExpandedChange]);
  const contractWindow = useCallback(() => {
    setIsWindowExpanded(false);
    onExpandedChange?.(false);
  }, [onExpandedChange]);
  const onNavSelected = useCallback((v: string) => setActiveTab(v), []);

  const buttons = useMemo(() => (
    <span className="me-3">
      <ExpandOrContractButton
        isWindowExpanded={isWindowExpanded}
        expandWindow={expandWindow}
        contractWindow={contractWindow}
      />
      <button type="button" className="btn btn-close ms-2" onClick={closeModal} aria-label="Close"></button>
    </span>
  ), [closeModal, isWindowExpanded, expandWindow, contractWindow]);

  return (
    <div>
      <ModalHeader className={isDeviceLargerThanLg ? 'p-0' : ''} toggle={closeModal} close={buttons}>
        {isDeviceLargerThanLg && (
          <CustomNavTab
            activeTab={activeTab}
            navTabMapping={navTabMapping}
            breakpointToHideInactiveTabsDown="md"
            onNavSelected={onNavSelected}
            hideBorderBottom
          />
        )}
      </ModalHeader>
      <ModalBody>
        {!isDeviceLargerThanLg && (
          <CustomNavDropdown
            activeTab={activeTab}
            navTabMapping={navTabMapping}
            onNavSelected={onNavSelected}
          />
        )}
        <CustomTabContent
          activeTab={activeTab}
          navTabMapping={navTabMapping}
          additionalClassNames={!isDeviceLargerThanLg ? ['grw-tab-content-style-md-down'] : undefined}
        />
      </ModalBody>
    </div>
  );
};

/**
 * DescendantsPageListModal - Container component (lightweight, always rendered)
 */
export const DescendantsPageListModal = (): React.JSX.Element => {
  const [isWindowExpanded, setIsWindowExpanded] = useState(false);
  const status = useDescendantsPageListModalStatus();
  const { close } = useDescendantsPageListModalActions();
  const isOpened = status?.isOpened ?? false;

  const handleExpandedChange = useCallback((isExpanded: boolean) => {
    setIsWindowExpanded(isExpanded);
  }, []);

  return (
    <Modal
      size="xl"
      isOpen={isOpened}
      toggle={close}
      data-testid="descendants-page-list-modal"
      className={`grw-descendants-page-list-modal ${styles['grw-descendants-page-list-modal']} ${isWindowExpanded ? 'grw-modal-expanded' : ''}`}
    >
      {isOpened && (
        <DescendantsPageListModalSubstance
          path={status?.path}
          closeModal={close}
          onExpandedChange={handleExpandedChange}
        />
      )}
    </Modal>
  );
};
