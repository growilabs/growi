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

import * as nextI18nConfig from '^/config/next-i18next.config.cjs';

import { GlobalFonts } from '~/components/FontFamily/GlobalFonts.js';
import type { CrowiRequest } from '~/interfaces/crowi-request.js';
import {
  useHydrateGlobalEachAtoms,
  useHydrateGlobalInitialAtoms,
} from '~/states/global/hydrate.js';
import { swrGlobalConfiguration } from '~/utils/swr-utils.js';

import type { CommonEachProps, CommonInitialProps } from './common-props/index.js';
import { isCommonInitialProps } from './common-props/index.js';
import { getLocaleAtServerSide } from './utils/locale.js';
import { useNextjsRoutingPageRegister } from './utils/nextjs-routing-utils.js';
import { registerTransformerForObjectId } from './utils/objectid-transformer.js';
import { deserializeSuperJSONProps } from './utils/superjson-ssr.js';

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

// biome-ignore lint/complexity/noBannedTypes: Define empty interface to extend later
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
  pageProps: rawPageProps,
  userLocale,
}: GrowiAppProps): JSX.Element => {
  const router = useRouter();

  // Deserialize superjson-serialized props from getServerSideProps
  const pageProps = deserializeSuperJSONProps(
    rawPageProps,
  ) as CombinedCommonProps;

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
  const appProps = await App.getInitialProps(appContext);
  const userLocale = getLocaleAtServerSide(
    appContext.ctx.req as unknown as CrowiRequest,
  );

  return { ...appProps, userLocale };
};

export default appWithTranslation(GrowiApp, nextI18nConfig);
