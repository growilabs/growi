import type { IPage, IUser, Lang } from '@growi/core';
import { addSeconds } from 'date-fns/addSeconds';
import ExtensibleCustomError from 'extensible-custom-error';
import fs from 'graceful-fs';
import mongoose from 'mongoose';
import path from 'path';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { configManager } from './config-manager';

const logger = loggerFactory('growi:service:installer');

export class FailedToCreateAdminUserError extends ExtensibleCustomError {}

export type AutoInstallOptions = {
  allowGuestMode?: boolean;
  serverDate?: Date;
};

export class InstallerService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  private async initSearchIndex() {
    const { searchService } = this.crowi;

    if (searchService == null || !searchService.isReachable) {
      return;
    }

    try {
      await searchService.rebuildIndex();
    } catch (err) {
      logger.error('Rebuild index failed', err);
    }
  }

  private async createPage(filePath, pagePath): Promise<IPage | undefined> {
    const { pageService } = this.crowi;

    try {
      const markdown = fs.readFileSync(filePath);
      return pageService.forceCreateBySystem(pagePath, markdown.toString(), {});
    } catch (err) {
      logger.error(`Failed to create ${pagePath}`, err);
    }
  }

  private async createInitialPages(
    lang: Lang,
    initialPagesCreatedAt?: Date,
  ): Promise<any> {
    const { localeDir } = this.crowi;
    // create /Sandbox/*
    /*
     * Keep in this order to
     *   1. avoid creating the same pages
     *   2. avoid difference for order in VRT
     */
    await this.createPage(path.join(localeDir, lang, 'sandbox.md'), '/Sandbox');
    await this.createPage(
      path.join(localeDir, lang, 'sandbox-markdown.md'),
      '/Sandbox/Markdown',
    );
    await this.createPage(
      path.join(localeDir, lang, 'sandbox-bootstrap5.md'),
      '/Sandbox/Bootstrap5',
    );
    await this.createPage(
      path.join(localeDir, lang, 'sandbox-diagrams.md'),
      '/Sandbox/Diagrams',
    );
    await this.createPage(
      path.join(localeDir, lang, 'sandbox-math.md'),
      '/Sandbox/Math',
    );

    // update createdAt and updatedAt fields of all pages
    if (initialPagesCreatedAt != null) {
      try {
        // TODO typescriptize models/user.js and remove eslint-disable-next-line
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Page = mongoose.model('Page') as any;

        // Increment timestamp to avoid difference for order in VRT
        const pagePaths = [
          '/Sandbox',
          '/Sandbox/Bootstrap4',
          '/Sandbox/Diagrams',
          '/Sandbox/Math',
        ];
        const promises = pagePaths.map(async (path: string, idx: number) => {
          const date = addSeconds(initialPagesCreatedAt, idx);
          return Page.update(
            { path },
            {
              createdAt: date,
              updatedAt: date,
            },
          );
        });
        await Promise.all(promises);
      } catch (err) {
        logger.error('Failed to update createdAt', err);
      }
    }

    try {
      await this.initSearchIndex();
    } catch (err) {
      logger.error('Failed to build Elasticsearch Indices', err);
    }
  }

  /**
   * Execute only once for installing application
   */
  private async initDB(
    globalLang: Lang,
    options?: AutoInstallOptions,
  ): Promise<void> {
    await configManager.updateConfigs(
      {
        'app:installed': true,
        'app:isV5Compatible': true,
        'app:globalLang': globalLang,
      },
      { skipPubsub: true },
    );

    if (options?.allowGuestMode) {
      await configManager.updateConfig(
        'security:restrictGuestMode',
        'Readonly',
        { skipPubsub: true },
      );
    }
  }

  async install(
    firstAdminUserToSave: Pick<
      IUser,
      'name' | 'username' | 'email' | 'password'
    >,
    globalLang: Lang,
    options?: AutoInstallOptions,
  ): Promise<IUser> {
    await this.initDB(globalLang, options);

    const User = mongoose.model<IUser, { createUser }>('User');

    // create portal page for '/' before creating admin user
    try {
      await this.createPage(
        path.join(this.crowi.localeDir, globalLang, 'welcome.md'),
        '/',
      );
    } catch (err) {
      logger.error(err);
      throw err;
    }

    try {
      // create first admin user
      const { name, username, email, password } = firstAdminUserToSave;
      const adminUser = await User.createUser(
        name,
        username,
        email,
        password,
        globalLang,
      );
      await (adminUser as any).asyncGrantAdmin();

      // create initial pages
      await this.createInitialPages(globalLang, options?.serverDate);

      return adminUser;
    } catch (err) {
      logger.error(err);
      throw new FailedToCreateAdminUserError(err);
    }
  }
}
