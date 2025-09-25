import type { RefObject } from 'react';
import React, {
  useEffect, useCallback, useRef, useState, useMemo, type JSX,
} from 'react';

import SimpleBar from 'simplebar-react';
import { debounce } from 'throttle-debounce';

import { useSticky } from '~/client/services/side-effects/use-sticky';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:cli:StickyStretchableScroller');


export type StickyStretchableScrollerProps = {
  stickyElemSelector: string,
  simplebarRef?: (ref: RefObject<SimpleBar | null>) => void,
  calcViewHeight?: (scrollElement: HTMLElement) => number,
  children?: JSX.Element,
}

/**
 * USAGE:
 *
  const calcViewHeight = useCallback(() => {
    const containerElem = document.querySelector('#sticky-elem');
    const containerTop = containerElem.getBoundingClientRect().top;

    // stretch to the bottom of window
    return window.innerHeight - containerTop;
  });

  return (
    <StickyStretchableScroller
      stickyElemSelector="#sticky-elem"
      calcViewHeight={calcViewHeight}
    >
      <div>
        ...
      </div>
    </StickyStretchableScroller>
  );
 */
export const StickyStretchableScroller = (props: StickyStretchableScrollerProps): JSX.Element => {

  const {
    children, stickyElemSelector, calcViewHeight, simplebarRef: setSimplebarRef,
  } = props;

  const simplebarRef = useRef<SimpleBar>(null);
  const [simplebarMaxHeight, setSimplebarMaxHeight] = useState<number|undefined>();

  // Get sticky status
  const isSticky = useSticky(stickyElemSelector);

  /**
   * Reset scrollbar
   */
  const resetScrollbar = useCallback(() => {
    if (simplebarRef.current == null || calcViewHeight == null) {
      return;
    }

    const scrollElement = simplebarRef.current.getScrollElement();
    const newHeight = calcViewHeight(scrollElement);

    logger.debug('Set new height to simplebar', newHeight);

    // set new height
    setSimplebarMaxHeight(newHeight);
    // reculculate
    simplebarRef.current.recalculate();
  }, [calcViewHeight]);

  const resetScrollbarDebounced = useMemo(() => debounce(100, resetScrollbar), [resetScrollbar]);

  useEffect(() => {
    resetScrollbarDebounced();
  }, [isSticky, resetScrollbarDebounced]);

  // setup effect by resizing event
  useEffect(() => {
    const resizeHandler = () => {
      resetScrollbarDebounced();
    };

    window.addEventListener('resize', resizeHandler);

    // return clean up handler
    return () => {
      window.removeEventListener('resize', resizeHandler);
    };
  }, [resetScrollbarDebounced]);

  // setup effect on init
  useEffect(() => {
    resetScrollbarDebounced();
  }, [resetScrollbarDebounced]);

  // update ref
  useEffect(() => {
    if (setSimplebarRef != null) {
      setSimplebarRef(simplebarRef);
    }
  }, [setSimplebarRef]);

  return (
    <SimpleBar style={{ maxHeight: simplebarMaxHeight }} ref={simplebarRef}>
      { children }
    </SimpleBar>
  );
};
