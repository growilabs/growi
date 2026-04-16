import type { IPage, IUser, Lang } from '@growi/core';
import { addSeconds } from 'date-fns/addSeconds';
import ExtensibleCustomError from 'extensible-custom-error';
import fs from 'graceful-fs';
import mongoose from 'mongoose';
import path from 'path';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { SUPPORTED_LOCALES } from '../util/safe-path-utils';
import { configManager } from './config-manager';

const logger = loggerFactory('growi:service:installer');

export class FailedToCreateAdminUserError extends ExtensibleCustomError {}

export type AutoInstallOptions = {
  allowGuestMode?: boolean;
  serverDate?: Date;
};

const getSafeLang = (lang: Lang): Lang => {
  if (SUPPORTED_LOCALES.includes(lang)) return lang;
  return 'en_US';
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
      const normalizedPath = path.resolve(filePath);
      const baseDir = path.resolve(this.crowi.localeDir);
      if (!normalizedPath.startsWith(baseDir)) {
        throw new Error(`Path traversal detected: ${normalizedPath}`);
      }
      const markdown = fs.readFileSync(normalizedPath);
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

    const safeLang = getSafeLang(lang);

    // create /Sandbox/*
    /*
     * Keep in this order to
     *   1. avoid creating the same pages
     *   2. avoid difference for order in VRT
     */
    await this.createPage(
      path.join(localeDir, safeLang, 'sandbox.md'),
      '/Sandbox',
    );
    await this.createPage(
      path.join(localeDir, safeLang, 'sandbox-markdown.md'),
      '/Sandbox/Markdown',
    );
    await this.createPage(
      path.join(localeDir, safeLang, 'sandbox-bootstrap5.md'),
      '/Sandbox/Bootstrap5',
    );
    await this.createPage(
      path.join(localeDir, safeLang, 'sandbox-diagrams.md'),
      '/Sandbox/Diagrams',
    );
    await this.createPage(
      path.join(localeDir, safeLang, 'sandbox-math.md'),
      '/Sandbox/Math',
    );

    // update createdAt and updatedAt fields of all pages
    if (initialPagesCreatedAt != null) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: TODO: typescriptize models/user.js and remove biome suppressions
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
    const safeLang = getSafeLang(globalLang);

    await configManager.updateConfigs(
      {
        'app:installed': true,
        'app:isV5Compatible': true,
        'app:globalLang': safeLang,
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
    const safeLang = getSafeLang(globalLang);

    await this.initDB(safeLang, options);
    const User = mongoose.model<IUser, { createUser }>('User');

    // create portal page for '/' before creating admin user
    try {
      await this.createPage(
        path.join(this.crowi.localeDir, safeLang, 'welcome.md'),
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
        safeLang,
      );
      await (adminUser as any).asyncGrantAdmin();

      // create initial pages
      await this.createInitialPages(safeLang, options?.serverDate);

      return adminUser;
    } catch (err) {
      logger.error(err);
      throw new FailedToCreateAdminUserError(err);
    }
  }
}
