import type { JSX, ReactNode } from 'react';
import React, { useEffect } from 'react';
import type { NextPage } from 'next';
import type { AppContext, AppProps } from 'next/app';
import App from 'next/app';
import { useRouter } from 'next/router';
import type { Locale } from '@growi/core/dist/interfaces';
import { Provider } from 'jotai';
import { appWithTranslation } from 'next-i18next';
import { SWRConfig } from 'swr';

import * as nextI18nConfig from '^/config/next-i18next.config';

import { GlobalFonts } from '~/components/FontFamily/GlobalFonts';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import {
  useHydrateGlobalEachAtoms,
  useHydrateGlobalInitialAtoms,
} from '~/states/global/hydrate';
import { swrGlobalConfiguration } from '~/utils/swr-utils';

import type { CommonEachProps, CommonInitialProps } from './common-props';
import { isCommonInitialProps } from './common-props';
import { getLocaleAtServerSide } from './utils/locale';
import { useNextjsRoutingPageRegister } from './utils/nextjs-routing-utils';
import { registerTransformerForObjectId } from './utils/objectid-transformer';

import '~/styles/prebuilt/vendor.css';
import '~/styles/style-app.scss';

// register custom serializer
registerTransformerForObjectId();

const StateManagementContainer = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => {
  return (
    <SWRConfig value={swrGlobalConfiguration}>
      <Provider>{children}</Provider>
    </SWRConfig>
  );
};

// eslint-disable-next-line @typescript-eslint/ban-types
export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: JSX.Element) => ReactNode;
};

type CombinedCommonProps =
  | CommonEachProps
  | (CommonEachProps & CommonInitialProps);
type GrowiAppProps = AppProps<CombinedCommonProps> & {
  Component: NextPageWithLayout<CombinedCommonProps>;
  userLocale: Locale;
};

const GrowiAppSubstance = ({
  Component,
  pageProps,
  userLocale,
}: GrowiAppProps): JSX.Element => {
  const router = useRouter();

  // Hydrate global atoms with server-side data
  useHydrateGlobalInitialAtoms(
    isCommonInitialProps(pageProps) ? pageProps : undefined,
  );
  useHydrateGlobalEachAtoms(pageProps);

  useNextjsRoutingPageRegister(pageProps.nextjsRoutingPage);

  useEffect(() => {
    const updateLangAttribute = () => {
      if (document.documentElement.getAttribute('lang') !== userLocale) {
        document.documentElement.setAttribute('lang', userLocale);
      }
    };
    router.events.on('routeChangeComplete', updateLangAttribute);
    return () => {
      router.events.off('routeChangeComplete', updateLangAttribute);
    };
  }, [router, userLocale]);

  useEffect(() => {
    import('bootstrap/dist/js/bootstrap');
  }, []);

  // Use the layout defined at the page level, if available
  const getLayout = Component.getLayout ?? ((page) => page);

  return <>{getLayout(<Component {...pageProps} />)}</>;
};

function GrowiApp(props: GrowiAppProps): JSX.Element {
  return (
    <>
      <GlobalFonts />
      <StateManagementContainer>
        <GrowiAppSubstance {...props} />
      </StateManagementContainer>
    </>
  );
}

// inject userLocale by context
GrowiApp.getInitialProps = async (appContext: AppContext) => {
  const appProps = App.getInitialProps(appContext);
  const userLocale = getLocaleAtServerSide(
    appContext.ctx.req as unknown as CrowiRequest,
  );

  return { ...appProps, userLocale };
};

export default appWithTranslation(GrowiApp, nextI18nConfig);
