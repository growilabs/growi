import type { BasicLayoutConfigurationProps } from '../basic-layout-page/index.js';
import type {
  CommonEachProps,
  CommonInitialProps,
} from '../common-props/index.js';
import type {
  GeneralPageEachProps,
  GeneralPageInitialProps,
} from '../general-page/index.js';

type PageEachProps = {
  redirectFrom?: string;

  isIdenticalPathPage: boolean;

  templateTagData?: string[];
  templateBodyData?: string;
};

export type Stage2EachProps = GeneralPageEachProps & PageEachProps;
export type Stage2InitialProps = Stage2EachProps &
  GeneralPageInitialProps &
  BasicLayoutConfigurationProps;

export type EachProps = CommonEachProps & Stage2EachProps;
export type InitialProps = CommonEachProps &
  CommonInitialProps &
  Stage2InitialProps;
