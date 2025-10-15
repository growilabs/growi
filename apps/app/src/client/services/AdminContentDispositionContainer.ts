import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

interface ContentDispositionState {
  inlineMimeTypes: string[];
  attachmentMimeTypes: string[];
}

interface ContentDispositionGetResponse {
  currentDispositionSettings: {
    inlineMimeTypes: string[];
    attachmentMimeTypes: string[];
  };
}

interface ContentDispositionUpdateRequest {
  newInlineMimeTypes: string[];
  newAttachmentMimeTypes: string[];
}

interface ContentDispositionUpdateResponse {
  currentDispositionSettings: {
    inlineMimeTypes: string[];
    attachmentMimeTypes: string[];
  };
}

export default class AdminContentDispositionContainer extends Container<ContentDispositionState> {

  constructor() {
    super();

    if (isServer()) {
      return;
    }

    this.state = {
      inlineMimeTypes: [],
      attachmentMimeTypes: [],
    };
  }

  static getClassName(): string {
    return 'AdminContentDispositionContainer';
  }

  async retrieveContentDispositionSettings(): Promise<void> {
    const response = await apiv3Get<ContentDispositionGetResponse>('/content-disposition-settings/');
    const { currentDispositionSettings } = response.data;

    this.setState({
      inlineMimeTypes: currentDispositionSettings.inlineMimeTypes,
      attachmentMimeTypes: currentDispositionSettings.attachmentMimeTypes,
    });
  }

  async updateContentDispositionSettings(newInlineMimeTypes: string[], newAttachmentMimeTypes: string[]): Promise<void> {
    const requestBody: ContentDispositionUpdateRequest = {
      newInlineMimeTypes,
      newAttachmentMimeTypes,
    };
    const response = await apiv3Put<ContentDispositionUpdateResponse>('/content-disposition-settings/', requestBody);

    this.setState({
      inlineMimeTypes: response.data.currentDispositionSettings.inlineMimeTypes,
      attachmentMimeTypes: response.data.currentDispositionSettings.attachmentMimeTypes,
    });
  }

  getInlineMimeTypes(): string[] {
    return [...this.state.inlineMimeTypes];
  }

  getAttachmentMimeTypes(): string[] {
    return [...this.state.attachmentMimeTypes];
  }

  getAllConfiguredMimeTypes(): string[] {
    return [...this.state.inlineMimeTypes, ...this.state.attachmentMimeTypes];
  }

}
