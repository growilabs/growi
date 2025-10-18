import express from 'express';
import path from 'path';

import loggerFactory from '~/utils/logger';

import nextFactory from '../routes/next';

const logger = loggerFactory('growi:crowi:dev');

class CrowiDev {
  /**
   * @param {import('~/server/crowi').default} crowi Crowi instance
   *
   * @memberOf CrowiDev
   */
  constructor(crowi) {
    this.crowi = crowi;
  }

  init() {
    this.initPromiseRejectionWarningHandler();
  }

  initPromiseRejectionWarningHandler() {
    // https://qiita.com/syuilo/items/0800d7e44e93203c7285
    process.on('unhandledRejection', console.dir); // eslint-disable-line no-console
  }

  /**
   *
   * @param {any} app express
   */
  setupServer(app) {
    const port = this.crowi.port;
    let server = app;

    this.setupExpressBeforeListening(app);

    // for log
    let serverUrl = `http://localhost:${port}}`;

    if (this.crowi.env.DEV_HTTPS) {
      logger.info(
        `[${this.crowi.node_env}] Express server will start with HTTPS Self-Signed Certification`,
      );

      serverUrl = `https://localhost:${port}}`;

      const fs = require('graceful-fs');
      const https = require('https');

      const options = {
        key: fs.readFileSync(
          path.join(this.crowi.rootDir, './resource/certs/localhost/key.pem'),
        ),
        cert: fs.readFileSync(
          path.join(this.crowi.rootDir, './resource/certs/localhost/cert.pem'),
        ),
      };

      server = https.createServer(options, app);
    }

    const eazyLogger = require('eazy-logger').Logger({
      prefix: '[{green:GROWI}] ',
      useLevelPrefixes: false,
    });

    eazyLogger.info('{bold:Server URLs:}');
    eazyLogger.unprefixed(
      'info',
      '{grey:=======================================}',
    );
    eazyLogger.unprefixed('info', `         APP: {magenta:${serverUrl}}`);
    eazyLogger.unprefixed(
      'info',
      '{grey:=======================================}',
    );

    return server;
  }

  setupExpressBeforeListening(app) {
    this.setupNextBundleAnalyzer(app);
  }

  setupExpressAfterListening(app) {
    this.setupNextjsStackFrame(app);
  }

  setupNextBundleAnalyzer(app) {
    const next = nextFactory(this.crowi);
    app.use(
      '/analyze',
      express.static(path.resolve(__dirname, '../../../.next/analyze')),
    );
  }

  setupNextjsStackFrame(app) {
    const next = nextFactory(this.crowi);
    app.get('/__nextjs_original-stack-frame', next.delegateToNext);
  }
}

module.exports = CrowiDev;
