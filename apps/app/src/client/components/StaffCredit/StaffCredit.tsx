import React, {
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import localFont from 'next/font/local';
import type { AnimationPlaybackControls } from 'motion';
import { animate } from 'motion';
import { Modal, ModalBody } from 'reactstrap';

import { useSWRxStaffs } from '~/stores/staff';
import loggerFactory from '~/utils/logger';

import styles from './StaffCredit.module.scss';

const _logger = loggerFactory('growi:components:StaffCredit');

const SCROLL_DELAY = 200; // ms
const SCROLL_SPEED = 300; // pixels per second

// define fonts
const pressStart2P = localFont({
  src: '../../../../resource/fonts/PressStart2P-latin.woff2',
  display: 'block',
  preload: false,
});

type Props = {
  onClosed?: () => void;
};

const StaffCredit = (props: Props): JSX.Element => {
  const { onClosed } = props;

  const { data: contributors } = useSWRxStaffs();

  const [isScrolling, setScrolling] = useState(false);
  const animationRef = useRef<AnimationPlaybackControls | null>(null);

  const stopAutoScroll = useCallback(() => {
    animationRef.current?.stop();
    animationRef.current = null;
    setScrolling(false);
  }, []);

  // Stop auto-scroll on wheel or scrollbar interaction
  useEffect(() => {
    if (!isScrolling) return;

    const modalBody = document.getElementById('modalBody');
    if (modalBody == null) return;

    const handleWheel = () => {
      stopAutoScroll();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const scrollbarStart =
        modalBody.getBoundingClientRect().left + modalBody.clientWidth;
      if (event.clientX >= scrollbarStart) {
        stopAutoScroll();
      }
    };

    modalBody.addEventListener('wheel', handleWheel, { passive: true });
    modalBody.addEventListener('pointerdown', handlePointerDown);

    return () => {
      modalBody.removeEventListener('wheel', handleWheel);
      modalBody.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isScrolling, stopAutoScroll]);

  const closeHandler = useCallback(() => {
    if (onClosed != null) {
      onClosed();
    }
  }, [onClosed]);

  const contentsClickedHandler = useCallback(() => {
    if (isScrolling) {
      stopAutoScroll();
    } else {
      closeHandler();
    }
  }, [closeHandler, isScrolling, stopAutoScroll]);

  const renderMembers = useCallback((memberGroup, keyPrefix) => {
    // construct members elements
    const members = memberGroup.members.map((member) => {
      return (
        <div
          className={memberGroup.additionalClass}
          key={`${keyPrefix}-${member.name}-container`}
        >
          <span
            className="dev-position"
            key={`${keyPrefix}-${member.name}-position`}
          >
            {/* position or '&nbsp;' */}
            {member.position || '\u00A0'}
          </span>
          <p className="dev-name" key={`${keyPrefix}-${member.name}`}>
            {member.name}
          </p>
        </div>
      );
    });
    return (
      <React.Fragment key={`${keyPrefix}-fragment`}>{members}</React.Fragment>
    );
  }, []);

  const renderContributors = useCallback(() => {
    if (contributors == null) {
      return <></>;
    }

    const credit = contributors.map((contributor) => {
      // construct members elements
      const memberGroups = contributor.memberGroups.map((memberGroup, idx) => {
        return renderMembers(
          memberGroup,
          `${contributor.sectionName}-group${idx}`,
        );
      });
      return (
        <React.Fragment key={`${contributor.sectionName}-fragment`}>
          <div
            className={`row ${contributor.additionalClass}`}
            key={`${contributor.sectionName}-row`}
          >
            <h2
              className="col-md-12 dev-team staff-credit-mt-10rem staff-credit-mb-6rem"
              key={contributor.sectionName}
            >
              {contributor.sectionName}
            </h2>
            {memberGroups}
          </div>
          <div className="clearfix"></div>
        </React.Fragment>
      );
    });
    return (
      <button
        type="button"
        className="text-center staff-credit-content btn btn-link p-0 border-0"
        onClick={contentsClickedHandler}
      >
        <h1 className="staff-credit-mb-6rem">GROWI Contributors</h1>
        <div className="clearfix"></div>
        {credit}
      </button>
    );
  }, [contentsClickedHandler, contributors, renderMembers]);

  const openedHandler = useCallback(() => {
    const container = document.getElementById('modalBody');
    if (container == null) return;

    container.scrollTop = 0;
    setScrolling(true);

    const maxScroll = container.scrollHeight - container.clientHeight;

    animationRef.current = animate(0, maxScroll, {
      duration: maxScroll / SCROLL_SPEED,
      ease: 'linear',
      delay: SCROLL_DELAY / 1000,
      onUpdate: (v) => {
        container.scrollTop = v;
      },
      onComplete: () => {
        animationRef.current = null;
        setScrolling(false);
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
