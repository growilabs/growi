import loggerFactory from '~/utils/logger';


const logger = loggerFactory('growi:cli:DrawioCommunicationHelper');

export type DrawioConfig = {
  css: string,
  customFonts: string[],
  compressXml: boolean,
}

export type DrawioCommunicationCallbackOptions = {
  onClose?: () => void;
  onSave?: (drawioData: string) => void;
}

export class DrawioCommunicationHelper {

  drawioUri: string;

  drawioConfig: DrawioConfig;

  callbackOpts?: DrawioCommunicationCallbackOptions;


  constructor(drawioUri: string, drawioConfig: DrawioConfig, callbackOpts?: DrawioCommunicationCallbackOptions) {
    this.drawioUri = drawioUri;
    this.drawioConfig = drawioConfig;
    this.callbackOpts = callbackOpts;
  }

  onReceiveMessage(event: MessageEvent, drawioMxFile: string | null): void {

    // check origin
    if (event.origin != null && this.drawioUri != null) {
      const originUrl = new URL(event.origin);
      const drawioUrl = new URL(this.drawioUri);

      if (originUrl.origin !== drawioUrl.origin) {
        logger.debug(`Skipping the event because the origins are mismatched. expected: '${drawioUrl.origin}', actual: '${originUrl.origin}'`);
        return;
      }
    }

    // configure
    if (event.data === '{"event":"configure"}') {
      if (event.source == null) {
        return;
      }

      // refs:
      //  * https://desk.draw.io/support/solutions/articles/16000103852-how-to-customise-the-draw-io-interface
      //  * https://desk.draw.io/support/solutions/articles/16000042544-how-does-embed-mode-work-
      //  * https://desk.draw.io/support/solutions/articles/16000058316-how-to-configure-draw-io-
      event.source.postMessage(JSON.stringify({
        action: 'configure',
        config: this.drawioConfig,
      }), { targetOrigin: '*' });

      return;
    }

    // restore diagram data
    if (event.data === 'ready') {
      event.source?.postMessage(drawioMxFile, { targetOrigin: '*' });
      return;
    }

    if (typeof event.data === 'string' && event.data.match(/mxfile/)) {
      if (event.data.length > 0) {
        const parser = new DOMParser();
        const dom = parser.parseFromString(event.data, 'text/xml');
        const drawioData = dom.getElementsByTagName('diagram')[0].innerHTML;

        /*
        * Saving Drawio will be implemented by the following tasks
        * https://redmine.weseek.co.jp/issues/100845
        * https://redmine.weseek.co.jp/issues/104507
        */

        this.callbackOpts?.onSave?.(drawioData);
      }

      this.callbackOpts?.onClose?.();

      return;
    }

    if (typeof event.data === 'string' && event.data.length === 0) {
      this.callbackOpts?.onClose?.();
      return;
    }

    // NOTHING DONE. (Receive unknown iframe message.)
  }

}
