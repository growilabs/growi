import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

/**
 * Service container for admin markdown setting page (MarkDownSetting.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminMarkDownContainer extends Container {
  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      retrieveError: null,
      isEnabledLinebreaks: false,
      isEnabledLinebreaksInComments: false,
      adminPreferredIndentSize: 4,
      isIndentSizeForced: false,
      isEnabledXss: false,
      xssOption: '',
      tagWhitelist: '',
      attrWhitelist: '{}',
    };

    this.switchEnableXss = this.switchEnableXss.bind(this);
    this.setAdminPreferredIndentSize =
      this.setAdminPreferredIndentSize.bind(this);
  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminMarkDownContainer';
  }

  /**
   * retrieve markdown data
   */
  async retrieveMarkdownData() {
    const response = await apiv3Get('/markdown-setting/');
    const { markdownParams } = response.data;

    this.setState({
      isEnabledLinebreaks: markdownParams.isEnabledLinebreaks,
      isEnabledLinebreaksInComments:
        markdownParams.isEnabledLinebreaksInComments,
      adminPreferredIndentSize: markdownParams.adminPreferredIndentSize,
      isIndentSizeForced: markdownParams.isIndentSizeForced,
      isEnabledXss: markdownParams.isEnabledXss,
      xssOption: markdownParams.xssOption,
      tagWhitelist: markdownParams.tagWhitelist || '',
      attrWhitelist: markdownParams.attrWhitelist || '',
    });
  }

  setAdminPreferredIndentSize(adminPreferredIndentSize) {
    this.setState({ adminPreferredIndentSize });
  }

  /**
   * Switch enableXss
   */
  switchEnableXss() {
    this.setState({ isEnabledXss: !this.state.isEnabledXss });
  }

  /**
   * Update LineBreak Setting
   */
  async updateLineBreakSetting() {
    const response = await apiv3Put('/markdown-setting/lineBreak', {
      isEnabledLinebreaks: this.state.isEnabledLinebreaks,
      isEnabledLinebreaksInComments: this.state.isEnabledLinebreaksInComments,
    });

    return response;
  }

  /**
   * Update
   */
  async updateIndentSetting() {
    const response = await apiv3Put('/markdown-setting/indent', {
      adminPreferredIndentSize: this.state.adminPreferredIndentSize,
      isIndentSizeForced: this.state.isIndentSizeForced,
    });

    return response;
  }

  /**
   * Update Xss Setting
   */
  async updateXssSetting() {
    let { tagWhitelist = '' } = this.state;
    const { attrWhitelist = '{}' } = this.state;

    tagWhitelist = Array.isArray(tagWhitelist)
      ? tagWhitelist
      : tagWhitelist.split(',');

    try {
      // Check if parsing is possible
      JSON.parse(attrWhitelist);
    } catch (err) {
      throw Error(`attrWhitelist parsing error occured: ${err.message}`);
    }

    await apiv3Put('/markdown-setting/xss', {
      isEnabledXss: this.state.isEnabledXss,
      xssOption: this.state.xssOption,
      tagWhitelist,
      attrWhitelist,
    });
  }
}
