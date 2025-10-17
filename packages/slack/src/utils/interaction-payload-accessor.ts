import assert from 'node:assert';

import type { IChannel } from '../interfaces/channel';
import type { IInteractionPayloadAccessor } from '../interfaces/request-from-slack';
import loggerFactory from './logger';

const logger = loggerFactory('@growi/slack:utils:interaction-payload-accessor');

export class InteractionPayloadAccessor implements IInteractionPayloadAccessor {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  private payload: any;

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  constructor(payload: any) {
    this.payload = payload;
  }

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  firstAction(): any | null {
    const actions = this.payload.actions;

    if (actions != null && actions[0] != null) {
      return actions[0];
    }

    return null;
  }

  getResponseUrl(): string {
    const responseUrl = this.payload.response_url;
    if (responseUrl != null) {
      return responseUrl;
    }

    const responseUrls = this.payload.response_urls;
    assert(responseUrls != null);
    assert(responseUrls[0] != null);

    return responseUrls[0].response_url;
  }

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  getStateValues(): any | null {
    const state = this.payload.state;
    if (state != null && state.values != null) {
      return state.values;
    }

    const view = this.payload.view;
    if (view != null && view.state != null && view.state.values != null) {
      return view.state.values;
    }

    return null;
  }

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  getViewPrivateMetaData(): any | null {
    const view = this.payload.view;

    if (view?.private_metadata) {
      return JSON.parse(view.private_metadata);
    }

    return null;
  }

  getActionIdAndCallbackIdFromPayLoad(): { [key: string]: string } {
    const actionId = this.firstAction()?.action_id || '';
    const callbackId = this.payload.view?.callback_id || '';

    return { actionId, callbackId };
  }

  getChannel(): IChannel | null {
    // private_metadata should have the channelName parameter when view_submission
    const privateMetadata = this.getViewPrivateMetaData();
    if (privateMetadata != null && privateMetadata.channelName != null) {
      throw new Error(
        'PrivateMetaDatas are not implemented after removal of modal from slash commands. Use payload instead.',
      );
    }
    const channel = this.payload.channel;
    if (channel != null) {
      return channel;
    }

    return null;
  }

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  getOriginalData(): any | null {
    const value = this.firstAction()?.value;
    if (value == null) return null;

    const { originalData } = JSON.parse(value);
    if (originalData == null) return JSON.parse(value);

    // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
    let parsedOriginalData;
    try {
      parsedOriginalData = JSON.parse(originalData);
    } catch (err) {
      logger.error('Failed to parse original data:\n', err);
      return null;
    }

    return parsedOriginalData;
  }
}
