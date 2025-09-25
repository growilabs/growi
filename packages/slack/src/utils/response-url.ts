import axios from 'axios';

import type { RespondBodyForResponseUrl } from '../interfaces/response-url';

export async function respond(
  responseUrl: string,
  body: RespondBodyForResponseUrl,
): Promise<void> {
  return axios.post(responseUrl, {
    replace_original: false,
    text: body.text,
    blocks: body.blocks,
  });
}

export async function respondInChannel(
  responseUrl: string,
  body: RespondBodyForResponseUrl,
): Promise<void> {
  return axios.post(responseUrl, {
    response_type: 'in_channel',
    replace_original: false,
    text: body.text,
    blocks: body.blocks,
  });
}

export async function replaceOriginal(
  responseUrl: string,
  body: RespondBodyForResponseUrl,
): Promise<void> {
  return axios.post(responseUrl, {
    replace_original: true,
    text: body.text,
    blocks: body.blocks,
  });
}

export async function deleteOriginal(responseUrl: string): Promise<void> {
  return axios.post(responseUrl, {
    delete_original: true,
  });
}
