import type { Request } from 'express';

export interface BlockKitRequest {
  // Block Kit properties
  body: {
    view?: string;
    blocks?: string;
  };
}

export type RequestFromGrowi = Request &
  BlockKitRequest & {
    // appended by GROWI
    headers: { 'x-growi-gtop-tokens'?: string };

    // will be extracted from header
    tokenGtoPs: string[];
  };

export type RequestFromProxy = Request & {
  // appended by Proxy
  headers: { 'x-growi-ptog-token'?: string };

  // will be extracted from header
  tokenPtoG: string[];
};
