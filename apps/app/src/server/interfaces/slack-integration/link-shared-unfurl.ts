export type PrivateData = {
  isPublic: false;
  isPermalink: boolean;
  id: string;
  path: string;
};

export type PublicData = {
  isPublic: true;
  isPermalink: boolean;
  id: string;
  path: string;
  pageBody: string;
  updatedAt: Date;
  commentCount: number;
};

export type DataForUnfurl = PrivateData | PublicData;

export type UnfurlEventLink = {
  url: string;
  domain: string;
};

export type UnfurlRequestEvent = {
  channel: string;

  // eslint-disable-next-line camelcase
  message_ts: string;

  links: UnfurlEventLink[];
};
