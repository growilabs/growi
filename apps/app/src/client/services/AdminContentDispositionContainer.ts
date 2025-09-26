import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

export default class AdminContentDispositionContainer extends Container<AdminContentDispositionContainer> {

  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      currentMode: 'strict',
      contentDispositionSettings: {
        'text/html': 'attachment',
        'image/svg+xml': 'attachment',
        'application/pdf': 'attachment',
        'application/json': 'attachment',
        'text/csv': 'attachment',
        'font/woff2': 'attachment',
        'font/woff': 'attachment',
        'font/ttf': 'attachment',
        'font/otf': 'attachment',
      },
    };


  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminContentDispositionContainer';
  }

  /**
   * retrieve markdown data
   */
  async retrieveContentDispositionSettings() {
    const response = await apiv3Get('/content-disposition-settings/');
    const { currentMode, contentDispositionSettings } = response.data;

    this.setState({
      currentMode,
      contentDispositionSettings
    });
  }

  async setStrictMode(): Promise<Response>  {
    const response = await apiv3Put('/content-disposition-settings/strict');

    const { currentMode, contentDispositionSettings } = response.data;

    this.setState({
      currentMode: currentMode,
      contentDispositionSettings: contentDispositionSettings
    })

    return response;
  }

  async setLaxMode(): Promise<Response>  {
    const response = await apiv3Put('/content-disposition-settings/lax');

    const { currentMode, contentDispositionSettings } = response.data;

    this.setState({
      currentMode: currentMode,
      contentDispositionSettings: contentDispositionSettings
    })

    return response;
  }

  async setHighRiskMimeType(mimeType: 'text/html' | 'image/svg+xml', disposition: 'inline' | 'attachment'): Promise<Response> {
    // double check if valid admin

    const body = {
      [mimeType]: disposition,
    };

    const response = await apiv3Put('/content-disposition-settings/admin-override', body);

    const { contentDispositionSettings } = response.data;

    this.setState({
      contentDispositionSettings: contentDispositionSettings
    })

    return respone;
  }
}
