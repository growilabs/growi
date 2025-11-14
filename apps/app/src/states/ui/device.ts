import { useEffect } from 'react';
import { Breakpoint } from '@growi/ui/dist/interfaces';
import {
  addBreakpointListener,
  cleanupBreakpointListener,
} from '@growi/ui/dist/utils';
import { atom, useAtom } from 'jotai';

// Device state atoms
export const isDeviceLargerThanXlAtom = atom(false);
export const isDeviceLargerThanLgAtom = atom(false);
export const isDeviceLargerThanMdAtom = atom(false);
export const isMobileAtom = atom(false);

export const useDeviceLargerThanXl = () => {
  const [isLargerThanXl, setIsLargerThanXl] = useAtom(isDeviceLargerThanXlAtom);

  useEffect(() => {
    const xlOrAboveHandler = function (this: MediaQueryList): void {
      // lg -> xl: matches will be true
      // xl -> lg: matches will be false
      setIsLargerThanXl(this.matches);
    };
    const mql = addBreakpointListener(Breakpoint.XL, xlOrAboveHandler);

    // initialize
    setIsLargerThanXl(mql.matches);

    return () => {
      cleanupBreakpointListener(mql, xlOrAboveHandler);
    };
  }, [setIsLargerThanXl]);

  return [isLargerThanXl, setIsLargerThanXl] as const;
};

export const useDeviceLargerThanLg = () => {
  const [isLargerThanLg, setIsLargerThanLg] = useAtom(isDeviceLargerThanLgAtom);

  useEffect(() => {
    const lgOrAboveHandler = function (this: MediaQueryList): void {
      // md -> lg: matches will be true
      // lg -> md: matches will be false
      setIsLargerThanLg(this.matches);
    };
    const mql = addBreakpointListener(Breakpoint.LG, lgOrAboveHandler);

    // initialize
    setIsLargerThanLg(mql.matches);

    return () => {
      cleanupBreakpointListener(mql, lgOrAboveHandler);
    };
  }, [setIsLargerThanLg]);

  return [isLargerThanLg, setIsLargerThanLg] as const;
};

export const useDeviceLargerThanMd = () => {
  const [isLargerThanMd, setIsLargerThanMd] = useAtom(isDeviceLargerThanMdAtom);

  useEffect(() => {
    const mdOrAboveHandler = function (this: MediaQueryList): void {
      // sm -> md: matches will be true
      // md -> sm: matches will be false
      setIsLargerThanMd(this.matches);
    };
    const mql = addBreakpointListener(Breakpoint.MD, mdOrAboveHandler);

    // initialize
    setIsLargerThanMd(mql.matches);

    return () => {
      cleanupBreakpointListener(mql, mdOrAboveHandler);
    };
  }, [setIsLargerThanMd]);

  return [isLargerThanMd, setIsLargerThanMd] as const;
};

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useAtom(isMobileAtom);

  useEffect(() => {
    // Ref: https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#mobile_device_detection
    let hasTouchScreen = false;
    hasTouchScreen =
      'maxTouchPoints' in navigator ? navigator?.maxTouchPoints > 0 : false;

    if (!hasTouchScreen) {
      const mQ = matchMedia?.('(pointer:coarse)');
      if (mQ?.media === '(pointer:coarse)') {
        hasTouchScreen = !!mQ.matches;
      } else {
        // Only as a last resort, fall back to user agent sniffing
        const UA = navigator.userAgent;
        hasTouchScreen =
          /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(UA) ||
          /\b(Android|Windows Phone|iPad|iPod)\b/i.test(UA);
      }
    }

    // Initialize with detected value
    setIsMobile(hasTouchScreen);
  }, [setIsMobile]);

  return [isMobile, setIsMobile] as const;
};
