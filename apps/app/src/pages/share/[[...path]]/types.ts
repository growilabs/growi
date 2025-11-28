import type {
  IDataWithRequiredMeta,
  IPageNotFoundInfo,
} from '@growi/core/dist/interfaces';

import type { IShareLinkHasId } from '~/interfaces/share-link';
import type { CommonEachProps, CommonInitialProps } from '~/pages/common-props';
import type {
  GeneralPageInitialProps,
  IPageToShowRevisionWithMeta,
} from '~/pages/general-page';

export type ShareLinkPageStatesProps = Pick<
  GeneralPageInitialProps,
  'skipSSR'
> &
  (
    | {
        // not found case
        pageWithMeta: IDataWithRequiredMeta<null, IPageNotFoundInfo>;
        isNotFound: true;
        isExpired: undefined;
        shareLink: undefined;
      }
    | {
        // expired case
        pageWithMeta: IPageToShowRevisionWithMeta;
        isNotFound: false;
        isExpired: true;
        shareLink: IShareLinkHasId;
      }
    | {
        // normal case
        pageWithMeta: IPageToShowRevisionWithMeta;
        isNotFound: false;
        isExpired: false;
        shareLink: IShareLinkHasId;
      }
  );

export type Stage2EachProps = ShareLinkPageStatesProps;
export type Stage2InitialProps = Stage2EachProps &
  Omit<GeneralPageInitialProps, 'pageWithMeta'>;

export type EachProps = CommonEachProps & Stage2EachProps;
export type InitialProps = CommonEachProps &
  CommonInitialProps &
  Stage2InitialProps;
