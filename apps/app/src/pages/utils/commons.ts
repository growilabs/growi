import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import type { ColorScheme, IUserHasId, Locale } from '@growi/core';
import { AllLang, Lang } from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
import { isServer } from '@growi/core/dist/utils';
import type { SSRConfig, UserConfig } from 'next-i18next';

import * as nextI18NextConfig from '^/config/next-i18next.config';

import type { SupportedActionType } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import type { IUserUISettings } from '~/interfaces/user-ui-settings';
import type { PageDocument } from '~/server/models/page';
import type { UserUISettingsDocument } from '~/server/models/user-ui-settings';
import { detectLocaleFromBrowserAcceptLanguage } from '~/server/util/locale-utils';
import {
  useCurrentProductNavWidth,
  useCurrentSidebarContents,
  usePreferCollapsedMode,
} from '~/stores/ui';
import { getGrowiVersion } from '~/utils/growi-version';

export type CommonProps = {
  namespacesRequired: string[]; // i18next
  currentPathname: string;
  appTitle: string;
  siteUrl: string | undefined;
  confidential: string;
  customTitleTemplate: string;
  isContainerFluid: boolean;
  growiVersion: string;
  isMaintenanceMode: boolean;
  redirectDestination: string | null;
  isDefaultLogo: boolean;
  growiCloudUri: string | undefined;
  isAccessDeniedForNonAdminUser?: boolean;
  currentUser?: IUserHasId;
  forcedColorScheme?: ColorScheme;
  userUISettings?: IUserUISettings;
} & Partial<SSRConfig>;

// eslint-disable-next-line max-len
export const getServerSideCommonProps: GetServerSideProps<CommonProps> = async (
  context: GetServerSidePropsContext,
) => {
  const getModelSafely = await import('~/server/util/mongoose-utils').then(
    (mod) => mod.getModelSafely,
  );

  const req = context.req as CrowiRequest;
  const { crowi, user } = req;
  const { appService, configManager, customizeService, attachmentService } =
    crowi;

  const url = new URL(context.resolvedUrl, 'http://example.com');
  const currentPathname = decodeURIComponent(url.pathname);

  const isMaintenanceMode = appService.isMaintenanceMode();

  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let currentUser;
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

  const isCustomizedLogoUploaded = await attachmentService.isBrandLogoExist();
  const isDefaultLogo =
    crowi.configManager.getConfig('customize:isDefaultLogo') ||
    !isCustomizedLogoUploaded;
  const forcedColorScheme = crowi.customizeService.forcedColorScheme;

  // retrieve UserUISett ings
  const UserUISettings =
    getModelSafely<UserUISettingsDocument>('UserUISettings');
  const userUISettings =
    user != null && UserUISettings != null
      ? await UserUISettings.findOne({ user: user._id }).exec()
      : req.session.uiSettings; // for guests

  const props: CommonProps = {
    namespacesRequired: ['translation'],
    currentPathname,
    appTitle: appService.getAppTitle(),
    siteUrl: configManager.getConfig('app:siteUrl'), // DON'T USE growiInfoService.getSiteUrl()
    confidential: appService.getAppConfidential() || '',
    customTitleTemplate: customizeService.customTitleTemplate,
    isContainerFluid:
      configManager.getConfig('customize:isContainerFluid') ?? false,
    growiVersion: getGrowiVersion(),
    isMaintenanceMode,
    redirectDestination,
    currentUser,
    isDefaultLogo,
    forcedColorScheme,
    growiCloudUri: configManager.getConfig('app:growiCloudUri'),
    userUISettings: userUISettings?.toObject?.() ?? userUISettings,
  };

  return { props };
};

export type LangMap = {
  readonly [key in Lang]: Locale;
};

export const langMap: LangMap = {
  [Lang.ja_JP]: 'ja-JP',
  [Lang.en_US]: 'en-US',
  [Lang.zh_CN]: 'zh-CN',
  [Lang.fr_FR]: 'fr-FR',
  [Lang.ko_KR]: 'ko-KR',
} as const;

// use this function to translate content
export const getLangAtServerSide = (req: CrowiRequest): Lang => {
  const { user, headers } = req;
  const { configManager } = req.crowi;

  return user == null
    ? detectLocaleFromBrowserAcceptLanguage(headers)
    : (user.lang ??
        configManager.getConfig('app:globalLang') ??
        Lang.en_US ??
        Lang.en_US);
};

// use this function to get locale for html lang attribute
export const getLocaleAtServerSide = (req: CrowiRequest): Locale => {
  return langMap[getLangAtServerSide(req)];
};

export const getNextI18NextConfig = async (
  // 'serverSideTranslations' method should be given from Next.js Page
  //  because importing it in this file causes https://github.com/isaachinman/next-i18next/issues/1545
  serverSideTranslations: (
    initialLocale: string,
    namespacesRequired?: string[] | undefined,
    configOverride?: UserConfig | null,
    extraLocales?: string[] | false,
  ) => Promise<SSRConfig>,
  context: GetServerSidePropsContext,
  namespacesRequired?: string[] | undefined,
  preloadAllLang = false,
): Promise<SSRConfig> => {
  // determine language
  const req: CrowiRequest = context.req as CrowiRequest;
  const lang = getLangAtServerSide(req);

  const namespaces = ['commons'];
  if (namespacesRequired != null) {
    namespaces.push(...namespacesRequired);
  }
  // TODO: deprecate 'translation.json' in the future
  else {
    namespaces.push('translation');
  }

  // The first argument must be a language code with an underscore, such as en_US
  return serverSideTranslations(
    lang,
    namespaces,
    nextI18NextConfig,
    preloadAllLang ? AllLang : false,
  );
};

/**
 * Generate whole title string for the specified title
 * @param props
 * @param title
 */
export const generateCustomTitle = (
  props: CommonProps,
  title: string,
): string => {
  return props.customTitleTemplate
    .replace('{{sitename}}', props.appTitle)
    .replace('{{pagepath}}', title)
    .replace('{{pagename}}', title);
};

/**
 * Generate whole title string for the specified page path
 * @param props
 * @param pagePath
 */
export const generateCustomTitleForPage = (
  props: CommonProps,
  pagePath: string,
): string => {
  const dPagePath = new DevidedPagePath(pagePath, true, true);

  return props.customTitleTemplate
    .replace('{{sitename}}', props.appTitle)
    .replace('{{pagepath}}', pagePath)
    .replace('{{pagename}}', dPagePath.latter);
};

export const useInitSidebarConfig = (
  sidebarConfig: ISidebarConfig,
  userUISettings?: IUserUISettings,
): void => {
  // UserUISettings
  usePreferCollapsedMode(
    userUISettings?.preferCollapsedModeByUser ??
      sidebarConfig.isSidebarCollapsedMode,
  );
  useCurrentSidebarContents(userUISettings?.currentSidebarContents);
  useCurrentProductNavWidth(userUISettings?.currentProductNavWidth);
};

export const skipSSR = async (
  page: PageDocument,
  ssrMaxRevisionBodyLength: number,
): Promise<boolean> => {
  if (!isServer()) {
    throw new Error('This method is not available on the client-side');
  }

  const latestRevisionBodyLength = await page.getLatestRevisionBodyLength();

  if (latestRevisionBodyLength == null) {
    return true;
  }

  return ssrMaxRevisionBodyLength < latestRevisionBodyLength;
};

export const addActivity = async (
  context: GetServerSidePropsContext,
  action: SupportedActionType,
): Promise<void> => {
  const req = context.req as CrowiRequest;

  const parameters = {
    ip: req.ip,
    endpoint: req.originalUrl,
    action,
    user: req.user?._id,
    snapshot: {
      username: req.user?.username,
    },
  };

  await req.crowi.activityService.createActivity(parameters);
};
