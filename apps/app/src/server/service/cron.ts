import type { ScheduledTask } from 'node-cron';
import nodeCron from 'node-cron';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:cron');

/**
 * Base class for services that manage a cronjob
 */
abstract class CronService {
  // The current cronjob to manage
  cronJob: ScheduledTask | undefined;

  /**
   * Create and start a new cronjob
   */
  startCron(): void {
    this.cronJob?.stop();
    this.cronJob = this.generateCronJob(this.getCronSchedule());
    this.cronJob.start();
  }

  /**
   * Stop the current cronjob
   */
  stopCron(): void {
    this.cronJob?.stop();
    this.cronJob = undefined;
  }

  isJobRunning(): boolean {
    return this.cronJob != null;
  }

  /**
   * Get the cron schedule
   * e.g. '0 1 * * *'
   */
  abstract getCronSchedule(): string;

  /**
   * Execute the job. Define the job process in the subclass.
   */
  abstract executeJob(): Promise<void>;

  /**
   * Create a new cronjob
   * @param cronSchedule e.g. '0 1 * * *'
   */
  protected generateCronJob(cronSchedule: string): ScheduledTask {
    return nodeCron.schedule(cronSchedule, async () => {
      try {
        await this.executeJob();
      } catch (e) {
        logger.error(e);
      }
    });
  }
}

export default CronService;
