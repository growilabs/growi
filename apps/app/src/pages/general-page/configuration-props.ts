import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { RegistrationMode } from '~/interfaces/registration-mode';

import type { RendererConfigProps, ServerConfigurationProps } from './types';

export const getServerSideRendererConfigProps: GetServerSideProps<
  RendererConfigProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  return {
    props: {
      rendererConfig: {
        isEnabledLinebreaks: configManager.getConfig(
          'markdown:isEnabledLinebreaks',
        ),
        isEnabledLinebreaksInComments: configManager.getConfig(
          'markdown:isEnabledLinebreaksInComments',
        ),
        isEnabledMarp: configManager.getConfig('customize:isEnabledMarp'),
        adminPreferredIndentSize: configManager.getConfig(
          'markdown:adminPreferredIndentSize',
        ),
        isIndentSizeForced: configManager.getConfig(
          'markdown:isIndentSizeForced',
        ),

        drawioUri: configManager.getConfig('app:drawioUri'),
        plantumlUri: configManager.getConfig('app:plantumlUri'),

        // XSS Options
        isEnabledXssPrevention: configManager.getConfig(
          'markdown:rehypeSanitize:isEnabledPrevention',
        ),
        sanitizeType: configManager.getConfig('markdown:rehypeSanitize:option'),
        customTagWhitelist: configManager.getConfig(
          'markdown:rehypeSanitize:tagNames',
        ),
        customAttrWhitelist:
          configManager.getConfig('markdown:rehypeSanitize:attributes') != null
            ? JSON.parse(
                configManager.getConfig('markdown:rehypeSanitize:attributes'),
              )
            : undefined,
        highlightJsStyleBorder: configManager.getConfig(
          'customize:highlightJsStyleBorder',
        ),
      },
    },
  };
};

export const getServerSideGeneralPageProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const {
    configManager,
    aclService,
    fileUploadService,
    slackIntegrationService,
    passportService,
  } = crowi;

  return {
    props: {
      serverConfig: {
        aiEnabled: configManager.getConfig('app:aiEnabled'),
        limitLearnablePageCountPerAssistant: configManager.getConfig(
          'openai:limitLearnablePageCountPerAssistant',
        ),
        isUsersHomepageDeletionEnabled: configManager.getConfig(
          'security:user-homepage-deletion:isEnabled',
        ),
        elasticsearchMaxBodyLengthToIndex: configManager.getConfig(
          'app:elasticsearchMaxBodyLengthToIndex',
        ),

        isRomUserAllowedToComment: configManager.getConfig(
          'security:isRomUserAllowedToComment',
        ),

        isSlackConfigured: slackIntegrationService.isSlackConfigured,
        isAclEnabled: aclService.isAclEnabled(),
        drawioUri: configManager.getConfig('app:drawioUri'),
        isAllReplyShown: configManager.getConfig('customize:isAllReplyShown'),
        showPageSideAuthors: configManager.getConfig(
          'customize:showPageSideAuthors',
        ),
        isContainerFluid: configManager.getConfig('customize:isContainerFluid'),
        isEnabledStaleNotification: configManager.getConfig(
          'customize:isEnabledStaleNotification',
        ),
        disableLinkSharing: configManager.getConfig(
          'security:disableLinkSharing',
        ),
        isUploadAllFileAllowed: fileUploadService.getFileUploadEnabled(),
        isUploadEnabled: fileUploadService.getIsUploadable(),

        isBulkExportPagesEnabled: configManager.getConfig(
          'app:isBulkExportPagesEnabled',
        ),
        isPdfBulkExportEnabled:
          configManager.getConfig('app:pageBulkExportPdfConverterUri') != null,
        isLocalAccountRegistrationEnabled:
          passportService.isLocalStrategySetup &&
          configManager.getConfig('security:registrationMode') !==
            RegistrationMode.CLOSED,

        adminPreferredIndentSize: configManager.getConfig(
          'markdown:adminPreferredIndentSize',
        ),
        isIndentSizeForced: configManager.getConfig(
          'markdown:isIndentSizeForced',
        ),
        isEnabledAttachTitleHeader: configManager.getConfig(
          'customize:isEnabledAttachTitleHeader',
        ),
      },
    },
  };
};
