// based on https://gist.github.com/morajabi/523d7a642d8c0a2f71fcfa0d8b3d2846?permalink_comment_id=4688158#gistcomment-4688158

import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

type MutableRefObject<T> = {
  current: T;
};

type EventType = 'resize' | 'scroll';

const useEffectInEvent = (
  event: EventType,
  useCapture?: boolean,
  set?: () => void,
) => {
  useEffect(() => {
    if (set) {
      set();
      window.addEventListener(event, set, useCapture);

      return () => window.removeEventListener(event, set, useCapture);
    }
  }, [event, set, useCapture]);
};

export const useRect = <T extends HTMLDivElement | null>(
  reference: RefObject<T>,
  event: EventType = 'resize',
): [DOMRect | undefined, MutableRefObject<T | null>, number] => {
  const [rect, setRect] = useState<DOMRect>();

  const [screenHeight, setScreenHeight] = useState(window.innerHeight);

  const set = useCallback(() => {
    setRect(reference.current?.getBoundingClientRect());
  }, [reference]);

  useEffectInEvent(event, true, set);
  const handleResize = useCallback(() => {
    setScreenHeight(window.innerHeight);
  }, []);

  useEffect(() => {
    window.addEventListener(event, handleResize);
    return () => {
      window.removeEventListener(event, handleResize);
    };
  }, [event, handleResize]);

  return [rect, reference, screenHeight];
};
