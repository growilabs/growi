import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import loggerFactory from '~/utils/logger';

import { apiv3Get } from '../util/apiv3-client';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:services:AdminHomeContainer');

/**
 * Service container for admin homepage (AdminHome.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminHomeContainer extends Container {

  constructor() {
    super();

    if (isServer()) {
      return;
    }

    this.copyStateValues = {
      DEFAULT: 'default',
      DONE: 'done',
    };
    this.timer = null;

    this.state = {
      growiVersion: null,
      nodeVersion: null,
      npmVersion: null,
      pnpmVersion: null,
      copyState: this.copyStateValues.DEFAULT,
      installedPlugins: null,
      isV5Compatible: null,
      isMaintenanceMode: null,
    };

  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminHomeContainer';
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  /**
   * retrieve admin home data
   */
  async retrieveAdminHomeData() {
    try {
      const response = await apiv3Get('/admin-home/');
      const { adminHomeParams } = response.data;

      this.setState(prevState => ({
        ...prevState,
        growiVersion: adminHomeParams.growiVersion,
        nodeVersion: adminHomeParams.nodeVersion,
        npmVersion: adminHomeParams.npmVersion,
        pnpmVersion: adminHomeParams.pnpmVersion,
        envVars: adminHomeParams.envVars,
        isV5Compatible: adminHomeParams.isV5Compatible,
        isMaintenanceMode: adminHomeParams.isMaintenanceMode,
      }));
    }
    catch (err) {
      logger.error(err);
      throw new Error('Failed to retrive AdminHome data');
    }
  }

  /**
   * sets button text when copying system information
   */
  onCopyPrefilledHostInformation() {
    this.setState(prevState => ({
      ...prevState,
      copyState: this.copyStateValues.DONE,
    }));

    this.timer = setTimeout(() => {
      this.setState(prevState => ({
        ...prevState,
        copyState: this.copyStateValues.DEFAULT,
      }));
    }, 500);
  }

  /**
   * generates prefilled host information as markdown
   */
  generatePrefilledHostInformationMarkdown() {
    return `| item     | version |
| ---      | --- |
|OS        ||
|GROWI     |${this.state.growiVersion}|
|node.js   |${this.state.nodeVersion}|
|npm       |${this.state.npmVersion}|
|pnpm      |${this.state.pnpmVersion}|
|Using Docker|yes/no|
|Using [growi-docker-compose][growi-docker-compose]|yes/no|

[growi-docker-compose]: https://github.com/growilabs/growi-docker-compose

*(Accessing https://{GROWI_HOST}/admin helps you to fill in above versions)*`;
  }

}
