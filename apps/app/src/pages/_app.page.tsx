import type { ReactNode, JSX } from 'react';
import React, { useEffect } from 'react';

import type { Locale } from '@growi/core/dist/interfaces';
import type { NextPage } from 'next';
import { appWithTranslation } from 'next-i18next';
import type { AppContext, AppProps } from 'next/app';
import App from 'next/app';
import { useRouter } from 'next/router';
import { SWRConfig } from 'swr';

import * as nextI18nConfig from '^/config/next-i18next.config';

import { GlobalFonts } from '~/components/FontFamily/GlobalFonts';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import { useAutoUpdateGlobalAtoms } from '~/states/auto-update/global';
import { useHydrateGlobalAtoms } from '~/states/hydrate/global';
import { swrGlobalConfiguration } from '~/utils/swr-utils';

import { getLocaleAtServerSide, type CommonProps } from './utils/commons';
import { registerTransformerForObjectId } from './utils/objectid-transformer';

import '~/styles/prebuilt/vendor.css';
import '~/styles/style-app.scss';

// eslint-disable-next-line @typescript-eslint/ban-types
export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: JSX.Element) => ReactNode,
}

type GrowiAppProps = AppProps & {
  Component: NextPageWithLayout,
  userLocale: Locale,
};

// register custom serializer
registerTransformerForObjectId();

function GrowiApp({ Component, pageProps, userLocale }: GrowiAppProps): JSX.Element {
  const router = useRouter();

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

  const commonPageProps = pageProps as CommonProps;

  // Hydrate global atoms with server-side data
  useHydrateGlobalAtoms(commonPageProps);
  useAutoUpdateGlobalAtoms(commonPageProps);

  // Use the layout defined at the page level, if available
  const getLayout = Component.getLayout ?? (page => page);

  return (
    <>
      <GlobalFonts />
      <SWRConfig value={swrGlobalConfiguration}>
        {getLayout(<Component {...pageProps} />)}
      </SWRConfig>
    </>
  );
}

GrowiApp.getInitialProps = async(appContext: AppContext) => {
  const appProps = App.getInitialProps(appContext);
  const userLocale = getLocaleAtServerSide(appContext.ctx.req as unknown as CrowiRequest);

  return { ...appProps, userLocale };
};

export default appWithTranslation(GrowiApp, nextI18nConfig);
