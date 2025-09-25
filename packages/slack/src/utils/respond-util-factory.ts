import axios from 'axios';
import urljoin from 'url-join';

import type { IRespondUtil } from '../interfaces/respond-util';
import type { RespondBodyForResponseUrl } from '../interfaces/response-url';
import { isValidResponseUrl } from './response-url-validator';

type AxiosOptions = {
  headers?: {
    [header: string]: string;
  };
};

function getResponseUrlForProxy(proxyUri: string, responseUrl: string): string {
  return urljoin(proxyUri, `/g2s/respond?response_url=${responseUrl}`);
}

function getUrl(responseUrl: string, proxyUri?: string): string {
  const finalUrl =
    proxyUri === undefined
      ? responseUrl
      : getResponseUrlForProxy(proxyUri, responseUrl);

  if (!isValidResponseUrl(responseUrl, proxyUri)) {
    throw new Error('Invalid final response URL');
  }

  return finalUrl;
}

type RespondUtilConstructorArgs = {
  responseUrl: string;
  appSiteUrl: string;
  proxyUri?: string;
};

export class RespondUtil implements IRespondUtil {
  url!: string;

  options!: AxiosOptions;

  constructor({
    responseUrl,
    appSiteUrl,
    proxyUri,
  }: RespondUtilConstructorArgs) {
    this.url = getUrl(responseUrl, proxyUri);

    this.options = {
      headers: {
        'x-growi-app-site-url': appSiteUrl,
      },
    };
  }

  async respond(body: RespondBodyForResponseUrl): Promise<void> {
    return axios.post(
      this.url,
      {
        replace_original: false,
        text: body.text,
        blocks: body.blocks,
      },
      this.options,
    );
  }

  async respondInChannel(body: RespondBodyForResponseUrl): Promise<void> {
    return axios.post(
      this.url,
      {
        response_type: 'in_channel',
        replace_original: false,
        text: body.text,
        blocks: body.blocks,
      },
      this.options,
    );
  }

  async replaceOriginal(body: RespondBodyForResponseUrl): Promise<void> {
    return axios.post(
      this.url,
      {
        replace_original: true,
        text: body.text,
        blocks: body.blocks,
      },
      this.options,
    );
  }

  async deleteOriginal(): Promise<void> {
    return axios.post(
      this.url,
      {
        delete_original: true,
      },
      this.options,
    );
  }
}

export function generateRespondUtil(
  args: RespondUtilConstructorArgs,
): RespondUtil {
  return new RespondUtil(args);
}
