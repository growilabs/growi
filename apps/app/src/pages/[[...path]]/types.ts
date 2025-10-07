import type { BasicLayoutConfigurationProps } from '../basic-layout-page';
import type { CommonEachProps, CommonInitialProps } from '../common-props';
import type { GeneralPageEachProps, GeneralPageInitialProps } from '../general-page';

type PageEachProps = {
  redirectFrom?: string;

  isIdenticalPathPage: boolean,

  templateTagData?: string[],
  templateBodyData?: string,
};

export type Stage2EachProps = GeneralPageEachProps & PageEachProps;
export type Stage2InitialProps = Stage2EachProps & GeneralPageInitialProps & BasicLayoutConfigurationProps;

export type EachProps = CommonEachProps & Stage2EachProps;
export type InitialProps = CommonEachProps & CommonInitialProps & Stage2InitialProps;
