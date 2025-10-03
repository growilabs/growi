import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

import type AdminAppContainer from './AdminAppContainer';

type Disposition = 'inline' | 'attachment';
type ContentDispositionSettings = Record<string, Disposition>;

interface State {
  contentDispositionSettings: ContentDispositionSettings;
}
interface UpdateResponse {
  mimeType: string;
  disposition: Disposition;
}

export default class AdminContentDispositionContainer extends Container<State> {

  appContainer: AdminAppContainer;

  constructor(appContainer: AdminAppContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      contentDispositionSettings: {},
    };
  }

  static getClassName(): string {
    return 'AdminContentDispositionContainer';
  }

  async retrieveContentDispositionSettings(): Promise<void> {
    const response = await apiv3Get<State>('/content-disposition-settings/');
    const { contentDispositionSettings } = response.data;

    this.setState({
      contentDispositionSettings,
    });
  }

  async updateMimeTypeDisposition(mimeType: string, disposition: Disposition): Promise<void> {
    const response = await apiv3Put<UpdateResponse>(`/content-disposition-settings/${encodeURIComponent(mimeType)}`, {
      disposition,
    });

    this.setState({
      contentDispositionSettings: {
        ...this.state.contentDispositionSettings,
        [response.data.mimeType]: response.data.disposition,
      },
    });
  }

  async setInline(mimeType: string): Promise<void> {
    await this.updateMimeTypeDisposition(mimeType, 'inline');
  }

  async setAttachment(mimeType: string): Promise<void> {
    await this.updateMimeTypeDisposition(mimeType, 'attachment');
  }

  getDispositionForMimeType(mimeType: string): Disposition | undefined {
    return this.state.contentDispositionSettings[mimeType];
  }

  private getMimeTypesByDisposition(disposition: Disposition): string[] {
    return Object.entries(this.state.contentDispositionSettings)
      .filter(([, d]) => d === disposition)
      .map(([mimeType]) => mimeType);
  }

  getInlineMimeTypes(): string[] {
    return this.getMimeTypesByDisposition('inline');
  }

  getAllConfiguredMimeTypes(): string[] {
    return Object.keys(this.state.contentDispositionSettings);
  }

}
