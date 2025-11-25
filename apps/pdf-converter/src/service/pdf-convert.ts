import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline as pipelinePromise } from 'node:stream/promises';
import { OnInit } from '@tsed/common';
import { Service } from '@tsed/di';
import { Logger } from '@tsed/logger';
import type { PuppeteerNodeLaunchOptions } from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';

interface PageInfo {
  htmlString: string;
  htmlFilePath: string;
}

export const JobStatusSharedWithGrowi = {
  HTML_EXPORT_IN_PROGRESS: 'HTML_EXPORT_IN_PROGRESS',
  HTML_EXPORT_DONE: 'HTML_EXPORT_DONE',
  FAILED: 'FAILED',
} as const;

export const JobStatus = {
  ...JobStatusSharedWithGrowi,
  PDF_EXPORT_DONE: 'PDF_EXPORT_DONE',
} as const;

export type JobStatusSharedWithGrowi =
  (typeof JobStatusSharedWithGrowi)[keyof typeof JobStatusSharedWithGrowi];
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

interface JobInfo {
  expirationDate: Date;
  status: JobStatus;
  currentStream?: Readable;
}

@Service()
class PdfConvertService implements OnInit {
  private puppeteerCluster: Cluster | undefined;

  private convertRetryLimit = 5;

  private tmpOutputRootDir = '/tmp/page-bulk-export';

  private jobList: {
    [key: string]: JobInfo;
  } = {};

  constructor(private readonly logger: Logger) {}

  async $onInit(): Promise<void> {
    await this.initPuppeteerCluster();
  }

  /**
   * Register or update job inside jobList with given jobId, expirationDate, and status.
   * If job is new, start reading html files and convert them to pdf.
   * @param jobId PageBulkExportJob ID
   * @param expirationDate expiration date of job
   * @param status status of job
   * @param appId application ID for GROWI.cloud
   */
  async registerOrUpdateJob(
    jobId: string,
    expirationDate: Date,
    status: JobStatusSharedWithGrowi,
    appId?: number,
  ): Promise<void> {
    const isJobNew = !(jobId in this.jobList);

    if (isJobNew) {
      this.jobList[jobId] = { expirationDate, status };
    } else {
      const jobInfo = this.jobList[jobId];
      jobInfo.expirationDate = expirationDate;

      if (!this.isJobCompleted(jobId)) {
        jobInfo.status = status;
      }
    }

    if (status === JobStatus.FAILED) {
      this.jobList[jobId].currentStream?.destroy(new Error('job failed'));
    }

    if (isJobNew && status !== JobStatus.FAILED) {
      this.readHtmlAndConvertToPdfUntilFinish(jobId, appId);
    }
  }

  /**
   * Get job status
   * @param jobId id of PageBulkExportJob
   * @returns job status
   */
  getJobStatus(jobId: string): JobStatus {
    if (!(jobId in this.jobList)) return JobStatus.FAILED;
    return this.jobList[jobId].status;
  }

  /**
   * Clean up job list by removing expired jobs, finished jobs, and failed jobs
   */
  cleanUpJobList(): void {
    const now = new Date();
    for (const jobId of Object.keys(this.jobList)) {
      const job = this.jobList[jobId];
      if (now > job.expirationDate || this.isJobCompleted(jobId)) {
        job.currentStream?.destroy(new Error('job expired'));
        delete this.jobList[jobId];
      }
    }
  }

  /**
   * Close puppeteer cluster
   */
  async closePuppeteerCluster(): Promise<void> {
    if (this.puppeteerCluster == null) {
      this.logger.info('No puppeteer cluster running for closure');
      return;
    }

    this.logger.info('Closing puppeteer cluster...');
    await this.puppeteerCluster.idle();
    await this.puppeteerCluster.close();
  }

  private isJobCompleted(jobId: string): boolean {
    if (this.jobList[jobId] == null) return true;
    return (
      this.jobList[jobId].status === JobStatus.PDF_EXPORT_DONE ||
      this.jobList[jobId].status === JobStatus.FAILED
    );
  }

  /**
   * Read html files from shared fs path, convert them to pdf, and save them to shared fs path.
   * Repeat this until all html files are converted to pdf or job fails.
   * @param jobId PageBulkExportJob ID
   * @param appId application ID for GROWI.cloud
   */
  private async readHtmlAndConvertToPdfUntilFinish(
    jobId: string,
    appId?: number,
  ): Promise<void> {
    while (!this.isJobCompleted(jobId)) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 10 * 1000));

      try {
        if (new Date() > this.jobList[jobId].expirationDate) {
          throw new Error('Job expired');
        }

        const htmlReadable = this.getHtmlReadable(jobId, appId);
        const pdfWritable = this.getPdfWritable();
        this.jobList[jobId].currentStream = htmlReadable;

        // eslint-disable-next-line no-await-in-loop
        await pipelinePromise(htmlReadable, pdfWritable);
        this.jobList[jobId].currentStream = undefined;
      } catch (err) {
        this.logger.error('Failed to convert html to pdf', err);
        this.jobList[jobId].status = JobStatus.FAILED;
        this.jobList[jobId].currentStream?.destroy(
          new Error('Failed to convert html to pdf'),
        );
        break;
      }
    }
  }

  /**
   * Get readable stream that reads html files from shared fs path
   * @param jobId PageBulkExportJob ID
   * @param appId application ID for GROWI.cloud
   * @returns readable stream
   */
  private getHtmlReadable(jobId: string, appId?: number): Readable {
    const jobHtmlDir = path.join(
      this.tmpOutputRootDir,
      appId?.toString() ?? '',
      'html',
      jobId,
    );
    const htmlFileEntries = fs
      .readdirSync(jobHtmlDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile());
    let index = 0;

    const jobList = this.jobList;

    return new Readable({
      objectMode: true,
      async read() {
        if (index >= htmlFileEntries.length) {
          if (
            jobList[jobId].status === JobStatus.HTML_EXPORT_DONE &&
            htmlFileEntries.length === 0
          ) {
            jobList[jobId].status = JobStatus.PDF_EXPORT_DONE;
          }
          this.push(null);
          return;
        }

        const entry = htmlFileEntries[index];
        const htmlFilePath = path.join(entry.parentPath, entry.name);
        const htmlString = await fs.promises.readFile(htmlFilePath, 'utf-8');

        this.push({ htmlString, htmlFilePath });

        index += 1;
      },
    });
  }

  /**
   * Get writable stream that converts html to pdf, and save it to shared fs path
   * @returns writable stream
   */
  private getPdfWritable(): Writable {
    return new Writable({
      objectMode: true,
      write: async (pageInfo: PageInfo, encoding, callback) => {
        const pattern = new RegExp(
          `^${this.tmpOutputRootDir}(?:\\/([0-9]+))?\\/html\\/(.+?)\\.html$`,
        );

        const match = pageInfo.htmlFilePath.match(pattern);
        if (match == null) {
          // Skip to next pageInfo if path doesn't match expected layout
          callback();
          return;
        }

        // match[1] → optional numeric dir, match[2] → basename (without extension)
        const numericSegment = match[1] ? `/${match[1]}` : '';
        const baseName = match[2];

        const fileOutputPath = `${this.tmpOutputRootDir}${numericSegment}/${baseName}.pdf`;
        const fileOutputParentPath = this.getParentPath(fileOutputPath);

        try {
          const pdfBody = await this.convertHtmlToPdf(pageInfo.htmlString);
          await fs.promises.mkdir(fileOutputParentPath, { recursive: true });
          await fs.promises.writeFile(fileOutputPath, pdfBody);

          await fs.promises.rm(pageInfo.htmlFilePath, { force: true });
        } catch (err) {
          if (err instanceof Error) {
            callback(err);
          }
          return;
        }
        callback();
      },
    });
  }

  /**
   * Convert html to pdf. Retry up to convertRetryLimit if failed.
   * @param htmlString html to convert to pdf
   * @returns converted pdf
   */
  private async convertHtmlToPdf(htmlString: string): Promise<Buffer> {
    const executeConvert = async (retries: number): Promise<Buffer> => {
      try {
        return this.puppeteerCluster?.execute(htmlString);
      } catch (err) {
        if (retries > 0) {
          this.logger.error(
            'Failed to convert markdown to pdf. Retrying...',
            err,
          );
          return executeConvert(retries - 1);
        }
        throw err;
      }
    };

    const result = await executeConvert(this.convertRetryLimit);

    return result;
  }

  /**
   * Initialize puppeteer cluster
   */
  private async initPuppeteerCluster(): Promise<void> {
    if (process.env.SKIP_PUPPETEER_INIT === 'true') return;

    const config = this.getPuppeteerClusterConfig();
    this.puppeteerCluster = await Cluster.launch(config);

    await this.puppeteerCluster.task(async ({ page, data: htmlString }) => {
      await page.setContent(htmlString, { waitUntil: 'domcontentloaded' });
      await page.addStyleTag({
        content: `
          body {
            font-family: 'Lato', 'IPAGothic', 'Noto Sans CJK';
          }
        `,
      });
      await page.emulateMediaType('screen');
      const pdfResult = await page.pdf({
        margin: {
          top: '100px',
          right: '50px',
          bottom: '100px',
          left: '50px',
        },
        printBackground: true,
        format: 'A4',
      });
      return pdfResult;
    });
  }

  /**
   * Get puppeteer cluster configuration from environment variable
   * @returns merged cluster configuration
   */
  private getPuppeteerClusterConfig(): Record<string, any> {
    // Default cluster configuration
    const defaultConfig = {
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: 1,
      workerCreationDelay: 10000,
      // Puppeteer options (not configurable for security reasons)
      // ref) https://github.com/growilabs/growi/pull/10192
      puppeteerOptions: {
        args: ['--no-sandbox'],
      },
    };

    // Parse configuration from environment variable
    let customConfig: Record<string, any> = {};
    if (process.env.PUPPETEER_CLUSTER_CONFIG) {
      try {
        customConfig = JSON.parse(process.env.PUPPETEER_CLUSTER_CONFIG);
      } catch (err) {
        this.logger.warn(
          'Failed to parse PUPPETEER_CLUSTER_CONFIG, using default values',
          err,
        );
      }
    }

    // Remove puppeteerOptions from custom config if present (not allowed for security)
    if (customConfig.puppeteerOptions) {
      this.logger.warn(
        'puppeteerOptions configuration is not allowed for security reasons and will be ignored',
      );
      delete customConfig.puppeteerOptions;
    }

    // Merge configurations (customConfig overrides defaultConfig, except puppeteerOptions)
    return {
      ...defaultConfig,
      ...customConfig,
    };
  }

  /**
   * Get parent path from given path
   * @param path target path
   * @returns parent path
   */
  private getParentPath(path: string): string {
    const parentPath = path.split('/').slice(0, -1).join('/');
    if (parentPath === '' || parentPath === '/') {
      return '/';
    }
    return parentPath;
  }
}

export default PdfConvertService;
