import { useEffect } from 'react';
import type { GetServerSidePropsContext } from 'next';
import Cookies from 'js-cookie';

const COOKIE_NAME = 'nextjsRoutingPage';

export const useNextjsRoutingPageRegister = (
  nextjsRoutingPage: string | undefined,
): void => {
  useEffect(() => {
    if (nextjsRoutingPage == null) {
      Cookies.remove(COOKIE_NAME);
      return;
    }

    Cookies.set(COOKIE_NAME, nextjsRoutingPage, { path: '/', expires: 1 / 24 }); // expires in 1 hour
  }, [nextjsRoutingPage]);
};

export const NextjsRoutingType = {
  INITIAL: 'initial',
  SAME_ROUTE: 'same-route',
  FROM_OUTSIDE: 'from-outside',
} as const;
export type NextjsRoutingType =
  (typeof NextjsRoutingType)[keyof typeof NextjsRoutingType];

export const detectNextjsRoutingType = (
  context: GetServerSidePropsContext,
  previousRoutingPage: string,
): NextjsRoutingType => {
  const isCSR = !!context.req.headers['x-nextjs-data'];

  if (!isCSR) {
    return NextjsRoutingType.INITIAL;
  }

  // Read cookie from server-side context
  const nextjsRoutingPage = context.req.cookies[COOKIE_NAME];

  if (nextjsRoutingPage != null && nextjsRoutingPage === previousRoutingPage) {
    return NextjsRoutingType.SAME_ROUTE;
  }

  return NextjsRoutingType.FROM_OUTSIDE;
};
