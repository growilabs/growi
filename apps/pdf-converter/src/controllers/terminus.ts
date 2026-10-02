import { Injectable } from '@tsed/di';
import { Logger } from '@tsed/logger';

import PdfConvertService from '../service/pdf-convert.js';

@Injectable()
class TerminusCtrl {
  constructor(
    private readonly pdfConvertService: PdfConvertService,
    private readonly logger: Logger,
  ) {}

  async $onSignal(): Promise<void> {
    this.logger.info('Server is starting cleanup');
    await this.pdfConvertService.closePuppeteerCluster();
  }

  $onShutdown(): void {
    this.logger.info('Cleanup finished, server is shutting down');
  }
}

export default TerminusCtrl;
