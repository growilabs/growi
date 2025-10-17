import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import type { ColorScheme, IUserHasId } from '@growi/core';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:pages:common-props:commons');

export type CommonInitialProps = {
  isNextjsRoutingTypeInitial: true;
  appTitle: string;
  siteUrl: string | undefined;
  siteUrlWithEmptyValueWarn: string;
  confidential: string;
  growiVersion: string;
  isDefaultLogo: boolean;
  customTitleTemplate: string;
  growiCloudUri: string | undefined;
  growiAppIdForGrowiCloud: number | undefined;
  forcedColorScheme?: ColorScheme;
};

export const getServerSideCommonInitialProps: GetServerSideProps<
  CommonInitialProps
> = async (context: GetServerSidePropsContext) => {
  const req = context.req as CrowiRequest;
  const { crowi } = req;
  const {
    appService,
    configManager,
    attachmentService,
    customizeService,
    growiInfoService,
  } = crowi;

  const isCustomizedLogoUploaded = await attachmentService.isBrandLogoExist();
  const isDefaultLogo =
    crowi.configManager.getConfig('customize:isDefaultLogo') ||
    !isCustomizedLogoUploaded;
  const forcedColorScheme = crowi.customizeService.forcedColorScheme;

  return {
    props: {
      isNextjsRoutingTypeInitial: true,
      appTitle: appService.getAppTitle(),
      siteUrl: configManager.getConfig('app:siteUrl'),
      siteUrlWithEmptyValueWarn: growiInfoService.getSiteUrl(),
      confidential: appService.getAppConfidential() || '',
      growiVersion: getGrowiVersion(),
      isDefaultLogo,
      customTitleTemplate: customizeService.customTitleTemplate,
      growiCloudUri: configManager.getConfig('app:growiCloudUri'),
      growiAppIdForGrowiCloud: configManager.getConfig(
        'app:growiAppIdForCloud',
      ),
      forcedColorScheme,
    },
  };
};

export const isCommonInitialProps = (
  props: unknown,
): props is CommonInitialProps => {
  if (typeof props !== 'object' || props === null) {
    logger.warn('isCommonInitialProps: props is not an object or is null');
    return false;
  }

  const p = props as Record<string, unknown>;

  // Essential properties validation
  if (p.isNextjsRoutingTypeInitial !== true) {
    logger.warn(
      'isCommonInitialProps: isNextjsRoutingTypeInitial is not true',
      { isNextjsRoutingTypeInitial: p.isNextjsRoutingTypeInitial },
    );
    return false;
  }

  return true;
};

export type CommonEachProps = {
  currentPathname: string;
  nextjsRoutingPage?: string; // must be set by each page
  currentUser?: IUserHasId;
  csrfToken: string;
  isMaintenanceMode: boolean;
  redirectDestination?: string | null;
};

/**
 * Type guard for SameRouteEachProps validation
 * Lightweight validation for same-route navigation
 */
function isValidCommonEachRouteProps(
  props: unknown,
  shouldContainNextjsRoutingPage = false,
): props is CommonEachProps {
  if (typeof props !== 'object' || props === null) {
    logger.warn(
      'isValidCommonEachRouteProps: props is not an object or is null',
    );
    return false;
  }

  const p = props as Record<string, unknown>;

  // Essential properties validation
  if (shouldContainNextjsRoutingPage) {
    if (
      typeof p.nextjsRoutingPage !== 'string' &&
      p.nextjsRoutingPage !== undefined
    ) {
      logger.warn(
        'isValidCommonEachRouteProps: nextjsRoutingPage is not a string or null',
        { nextjsRoutingPage: p.nextjsRoutingPage },
      );
      return false;
    }
  }
  if (typeof p.currentPathname !== 'string') {
    logger.warn(
      'isValidCommonEachRouteProps: currentPathname is not a string',
      { currentPathname: p.currentPathname },
    );
    return false;
  }
  if (typeof p.csrfToken !== 'string') {
    logger.warn('isValidCommonEachRouteProps: csrfToken is not a string', {
      csrfToken: p.csrfToken,
    });
    return false;
  }
  if (typeof p.isMaintenanceMode !== 'boolean') {
    logger.warn(
      'isValidCommonEachRouteProps: isMaintenanceMode is not a boolean',
      { isMaintenanceMode: p.isMaintenanceMode },
    );
    return false;
  }

  return true;
}

export const getServerSideCommonEachProps = async (
  context: GetServerSidePropsContext,
  nextjsRoutingPage?: string,
): ReturnType<GetServerSideProps<CommonEachProps>> => {
  const req = context.req as CrowiRequest;
  const { crowi, user } = req;
  const { appService } = crowi;

  const url = new URL(context.resolvedUrl, 'http://example.com');

  const currentPathname = decodeURIComponent(url.pathname);

  const isMaintenanceMode = appService.isMaintenanceMode();

  let currentUser: IUserHasId | undefined;
  if (user != null) {
    currentUser = user.toObject();
  }

  // Redirect destination for page transition by next/link
  let redirectDestination: string | null = null;
  if (!crowi.aclService.isGuestAllowedToRead() && currentUser == null) {
    redirectDestination = '/login';
  } else if (!isMaintenanceMode && currentPathname === '/maintenance') {
    redirectDestination = '/';
  } else if (
    isMaintenanceMode &&
    !currentPathname.match('/admin/*') &&
    !(currentPathname === '/maintenance')
  ) {
    redirectDestination = '/maintenance';
  } else {
    redirectDestination = null;
  }

  const props = {
    currentPathname,
    nextjsRoutingPage,
    currentUser,
    csrfToken: req.csrfToken(),
    isMaintenanceMode,
    redirectDestination,
  };

  const shouldContainNextjsRoutingPage = nextjsRoutingPage != null;
  if (!isValidCommonEachRouteProps(props, shouldContainNextjsRoutingPage)) {
    throw new Error('Invalid common each route props structure');
  }

  return { props };
};
