import React, { useCallback, useState, type JSX } from 'react';

import localFont from 'next/font/local';
import { animateScroll } from 'react-scroll';
import {
  Modal, ModalBody,
} from 'reactstrap';

import { useSWRxStaffs } from '~/stores/staff';
import loggerFactory from '~/utils/logger';


import styles from './StaffCredit.module.scss';


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:cli:StaffCredit');


// define fonts
const pressStart2P = localFont({
  src: '../../../../resource/fonts/PressStart2P-latin.woff2',
  display: 'block',
  preload: false,
});


type Props = {
  onClosed?: () => void,
}

const StaffCredit = (props: Props): JSX.Element => {

  const { onClosed } = props;

  const { data: contributors } = useSWRxStaffs();

  const [isScrolling, setScrolling] = useState(false);


  const closeHandler = useCallback(() => {
    if (onClosed != null) {
      onClosed();
    }
  }, [onClosed]);

  const contentsClickedHandler = useCallback(() => {
    if (isScrolling) {
      setScrolling(false);
    }
    else {
      closeHandler();
    }
  }, [closeHandler, isScrolling]);

  const renderMembers = useCallback((memberGroup, keyPrefix) => {
    // construct members elements
    const members = memberGroup.members.map((member) => {
      return (
        <div className={memberGroup.additionalClass} key={`${keyPrefix}-${member.name}-container`}>
          <span className="dev-position" key={`${keyPrefix}-${member.name}-position`}>
            {/* position or '&nbsp;' */}
            { member.position || '\u00A0' }
          </span>
          <p className="dev-name" key={`${keyPrefix}-${member.name}`}>{member.name}</p>
        </div>
      );
    });
    return (
      <React.Fragment key={`${keyPrefix}-fragment`}>
        {members}
      </React.Fragment>
    );
  }, []);

  const renderContributors = useCallback(() => {
    if (contributors == null) {
      return <></>;
    }

    const credit = contributors.map((contributor) => {
      // construct members elements
      const memberGroups = contributor.memberGroups.map((memberGroup, idx) => {
        return renderMembers(memberGroup, `${contributor.sectionName}-group${idx}`);
      });
      return (
        <React.Fragment key={`${contributor.sectionName}-fragment`}>
          <div className={`row ${contributor.additionalClass}`} key={`${contributor.sectionName}-row`}>
            <h2 className="col-md-12 dev-team staff-credit-mt-10rem staff-credit-mb-6rem" key={contributor.sectionName}>{contributor.sectionName}</h2>
            {memberGroups}
          </div>
          <div className="clearfix"></div>
        </React.Fragment>
      );
    });
    return (
      <div className="text-center staff-credit-content" onClick={contentsClickedHandler}>
        <h1 className="staff-credit-mb-6rem">GROWI Contributors</h1>
        <div className="clearfix"></div>
        {credit}
      </div>
    );
  }, [contentsClickedHandler, contributors, renderMembers]);


  const openedHandler = useCallback(() => {
    // init
    animateScroll.scrollTo(0, { containerId: 'modalBody', duration: 0 });

    setScrolling(true);

    // start scrolling
    animateScroll.scrollToBottom({
      containerId: 'modalBody',
      smooth: 'linear',
      delay: 200,
      duration: (scrollDistanceInPx: number) => {
        const scrollSpeed = 200;
        return scrollDistanceInPx / scrollSpeed * 1000;
      },
    });
  }, []);


  const isLoaded = contributors !== undefined;

  if (contributors == null) {
    return <></>;
  }

  return (
    <Modal
      isOpen={isLoaded}
      toggle={closeHandler}
      scrollable
      className={`staff-credit ${styles['staff-credit']} ${pressStart2P.className}`}
      onOpened={openedHandler}
    >
      <ModalBody id="modalBody" className="credit-curtain">
        {renderContributors()}
      </ModalBody>
      <div className="background"></div>
    </Modal>
  );

};

export default StaffCredit;
