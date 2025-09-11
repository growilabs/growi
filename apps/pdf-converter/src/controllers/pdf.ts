import { BodyParams } from '@tsed/common';
import { Controller } from '@tsed/di';
import { BadRequest, InternalServerError } from '@tsed/exceptions';
import { Logger } from '@tsed/logger';
import {
  Description,
  Enum,
  Integer,
  Post,
  Required,
  Returns,
} from '@tsed/schema';
import PdfConvertService, {
  JobStatus,
  JobStatusSharedWithGrowi,
} from '../service/pdf-convert.js';

@Controller('/pdf')
class PdfCtrl {
  constructor(
    private readonly pdfConvertService: PdfConvertService,
    private readonly logger: Logger,
  ) {}

  @Post('/sync-job')
  @(
    Returns(202)
      .ContentType('application/json')
      .Schema({
        type: 'object',
        properties: {
          status: { type: 'string', enum: Object.values(JobStatus) },
        },
        required: ['status'],
      })
  )
  @Returns(500)
  @Description(`
    Sync job pdf convert status with GROWI.
    Register or update job inside pdf-converter with given jobId, expirationDate, and status.
    Return resulting status of job to GROWI.
  `)
  async syncJobStatus(
    @Required() @BodyParams('jobId') jobId: string,
    @Required() @BodyParams('expirationDate') expirationDateStr: string,
    @Required()
    @BodyParams('status')
    @Enum(Object.values(JobStatusSharedWithGrowi))
    growiJobStatus: JobStatusSharedWithGrowi,
    @Integer() @BodyParams('appId') appId?: number, // prevent path traversal attack
  ): Promise<{ status: JobStatus } | undefined> {
    // prevent path traversal attack
    if (!/^[a-f\d]{24}$/i.test(jobId)) {
      throw new BadRequest('jobId must be a valid MongoDB ObjectId');
    }

    const expirationDate = new Date(expirationDateStr);
    try {
      await this.pdfConvertService.registerOrUpdateJob(
        jobId,
        expirationDate,
        growiJobStatus,
        appId,
      );
      const status = this.pdfConvertService.getJobStatus(jobId); // get status before cleanup
      this.pdfConvertService.cleanUpJobList();
      return { status };
    } catch (err) {
      this.logger.error('Failed to register or update job', err);
      if (err instanceof Error) {
        throw new InternalServerError(err.message);
      }
    }
  }
}

export default PdfCtrl;
