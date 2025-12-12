import type {
  IDataWithRequiredMeta,
  IPageInfoExt,
  IPageNotFoundInfo,
  IPagePopulatedToShowRevision,
} from '@growi/core';

import type { RendererConfig } from '~/interfaces/services/renderer';
import type { PageDocument } from '~/server/models/page';

export type IPageToShowRevisionWithMeta = IDataWithRequiredMeta<
  IPagePopulatedToShowRevision & PageDocument,
  IPageInfoExt
>;

export type RendererConfigProps = {
  rendererConfig: RendererConfig;
};

export type ServerConfigurationProps = {
  serverConfig: {
    aiEnabled: boolean;
    limitLearnablePageCountPerAssistant: number;
    isUsersHomepageDeletionEnabled: boolean;
    adminPreferredIndentSize: number;
    elasticsearchMaxBodyLengthToIndex: number;
    isRomUserAllowedToComment: boolean;
    drawioUri: string | null;
    isAllReplyShown: boolean;
    showPageSideAuthors: boolean;
    isContainerFluid: boolean;
    isEnabledStaleNotification: boolean;
    disableLinkSharing: boolean;
    isIndentSizeForced: boolean;
    isEnabledAttachTitleHeader: boolean;
    isSlackConfigured: boolean;
    isAclEnabled: boolean;
    isUploadEnabled: boolean;
    isUploadAllFileAllowed: boolean;
    isBulkExportPagesEnabled: boolean;
    isPdfBulkExportEnabled: boolean;
    isLocalAccountRegistrationEnabled: boolean;
  };
};

// Do not include CommonEachProps for multi stage
// eslint-disable-next-line @typescript-eslint/ban-types
export type GeneralPageEachProps = {};

// Do not include CommonEachProps for multi stage
export type GeneralPageInitialProps = RendererConfigProps &
  ServerConfigurationProps & {
    pageWithMeta:
      | IPageToShowRevisionWithMeta
      | IDataWithRequiredMeta<null, IPageNotFoundInfo>
      | null;
    skipSSR?: boolean;
  };
