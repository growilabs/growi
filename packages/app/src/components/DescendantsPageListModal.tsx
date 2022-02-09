
import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Modal, ModalHeader, ModalBody,
} from 'reactstrap';

import { useDescendantsPageListModal } from '~/stores/ui';
import { useIsSharedUser } from '~/stores/context';

import DescendantsPageList from './DescendantsPageList';
import ExpandOrContractButton from './ExpandOrContractButton';
import { CustomNavTab } from './CustomNavigation/CustomNav';
import PageListIcon from './Icons/PageListIcon';
import TimeLineIcon from './Icons/TimeLineIcon';
import CustomTabContent from './CustomNavigation/CustomTabContent';
import PageTimeline from './PageTimeline';


type Props = {
}

export const DescendantsPageListModal = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('pagelist');
  const [isWindowExpanded, setIsWindowExpanded] = useState(false);

  const { data: isSharedUser } = useIsSharedUser();

  const { data: status, close } = useDescendantsPageListModal();

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: PageListIcon,
        Content: () => {
          if (status == null || status.path == null || !status.isOpened) {
            return <></>;
          }
          return <DescendantsPageList path={status.path} />;
        },
        i18n: t('page_list'),
        index: 0,
        isLinkEnabled: () => !isSharedUser,
      },
      timeline: {
        Icon: TimeLineIcon,
        Content: () => <PageTimeline />,
        i18n: t('Timeline View'),
        index: 1,
        isLinkEnabled: () => !isSharedUser,
      },
    };
  }, [isSharedUser, status, t]);

  const buttons = useMemo(() => (
    <div className="d-flex flex-nowrap">
      <ExpandOrContractButton
        isWindowExpanded={isWindowExpanded}
        expandWindow={() => setIsWindowExpanded(true)}
        contractWindow={() => setIsWindowExpanded(false)}
      />
      <button type="button" className="close" onClick={close} aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
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
      className={`grw-page-accessories-modal ${isWindowExpanded ? 'grw-modal-expanded' : ''} `}
    >
      <ModalHeader className="p-0" toggle={close} close={buttons}>
        <CustomNavTab
          activeTab={activeTab}
          navTabMapping={navTabMapping}
          breakpointToHideInactiveTabsDown="md"
          onNavSelected={v => setActiveTab(v)}
          hideBorderBottom
        />
      </ModalHeader>
      <ModalBody>
        <CustomTabContent activeTab={activeTab} navTabMapping={navTabMapping} />
      </ModalBody>
    </Modal>
  );

};
