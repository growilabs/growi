import { useCallback, useEffect, useMemo, useState } from 'react';

export interface FullScreenHandle {
  active: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
}

export const useFullScreen = (): FullScreenHandle => {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const handleChange = () => {
      setActive(document.fullscreenElement != null);
    };

    document.addEventListener('fullscreenchange', handleChange);
    return function cleanup() {
      document.removeEventListener('fullscreenchange', handleChange);
    };
  }, []);

  const enter = useCallback((elem?: HTMLElement) => {
    if (document.fullscreenElement != null) {
      return Promise.resolve();
    }

    const targetElem = elem ?? document.documentElement;
    return targetElem.requestFullscreen();
  }, []);

  const exit = useCallback(() => {
    if (document.fullscreenElement == null) {
      return Promise.resolve();
    }

    return document.exitFullscreen();
  }, []);

  return useMemo(
    () => ({
      active,
      enter,
      exit,
    }),
    [active, enter, exit],
  );
};
