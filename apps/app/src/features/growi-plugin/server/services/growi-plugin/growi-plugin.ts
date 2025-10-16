import type { GrowiThemeMetadata, ViteManifest } from '@growi/core';
import { GrowiPluginType } from '@growi/core';
import type { GrowiPluginPackageData } from '@growi/pluginkit';
import {
  importPackageJson,
  validateGrowiDirective,
} from '@growi/pluginkit/dist/v4/server/index.cjs';
// eslint-disable-next-line no-restricted-imports
import axios from 'axios';
import fs, { readFileSync } from 'fs';
import type mongoose from 'mongoose';
import path from 'path';
import { pipeline } from 'stream/promises';
import unzipStream from 'unzip-stream';

import loggerFactory from '~/utils/logger';

import type {
  IGrowiPlugin,
  IGrowiPluginMeta,
  IGrowiPluginOrigin,
} from '../../../interfaces';
import { PLUGIN_EXPRESS_STATIC_DIR, PLUGIN_STORING_PATH } from '../../consts';
import { GrowiPlugin } from '../../models';
import { GitHubUrl } from '../../models/vo/github-url';
import { generateTemplatePluginMeta } from './generate-template-plugin-meta';
import { generateThemePluginMeta } from './generate-theme-plugin-meta';

const logger = loggerFactory('growi:plugins:plugin-utils');

export type GrowiPluginResourceEntries = [
  installedPath: string,
  href: string,
][];

function retrievePluginManifest(
  growiPlugin: IGrowiPlugin,
): ViteManifest | undefined {
  // ref: https://vitejs.dev/guide/migration.html#manifest-files-are-now-generated-in-vite-directory-by-default
  const manifestPathByVite4 = path.join(
    PLUGIN_STORING_PATH,
    growiPlugin.installedPath,
    'dist/manifest.json',
  );
  const manifestPath = path.join(
    PLUGIN_STORING_PATH,
    growiPlugin.installedPath,
    'dist/.vite/manifest.json',
  );

  const isManifestByVite4Exists = fs.existsSync(manifestPathByVite4);
  const isManifestExists = fs.existsSync(manifestPath);

  if (!isManifestByVite4Exists && !isManifestExists) {
    return;
  }

  const manifestStr: string = readFileSync(
    isManifestExists ? manifestPath : manifestPathByVite4,
    'utf-8',
  );
  return JSON.parse(manifestStr);
}

type FindThemePluginResult = {
  growiPlugin: IGrowiPlugin;
  themeMetadata: GrowiThemeMetadata;
  themeHref: string | undefined;
};

export interface IGrowiPluginService {
  install(origin: IGrowiPluginOrigin): Promise<string>;
  findThemePlugin(theme: string): Promise<FindThemePluginResult | null>;
  retrieveAllPluginResourceEntries(): Promise<GrowiPluginResourceEntries>;
  downloadNotExistPluginRepositories(): Promise<void>;
}

export class GrowiPluginService implements IGrowiPluginService {
  /*
   * Downloading a non-existent repository to the file system
   */
  async downloadNotExistPluginRepositories(): Promise<void> {
    try {
      // find all growi plugin documents
      const growiPlugins = await GrowiPlugin.find({});

      // if not exists repository in file system, download latest plugin repository
      for await (const growiPlugin of growiPlugins) {
        let pluginPath: fs.PathLike | undefined;
        let organizationName: fs.PathLike | undefined;
        try {
          pluginPath = this.joinAndValidatePath(
            PLUGIN_STORING_PATH,
            growiPlugin.installedPath,
          );
          organizationName = this.joinAndValidatePath(
            PLUGIN_STORING_PATH,
            growiPlugin.organizationName,
          );
        } catch (err) {
          logger.error(err);
          continue;
        }
        if (fs.existsSync(pluginPath)) {
        } else {
          if (!fs.existsSync(organizationName)) {
            fs.mkdirSync(organizationName);
          }

          // TODO: imprv Document version and repository version possibly different.
          const ghUrl = new GitHubUrl(
            growiPlugin.origin.url,
            growiPlugin.origin.ghBranch,
          );
          const { reposName, archiveUrl, extractedArchiveDirName } = ghUrl;

          const zipFilePath = path.join(
            PLUGIN_STORING_PATH,
            `${extractedArchiveDirName}.zip`,
          );
          const unzippedPath = PLUGIN_STORING_PATH;
          const unzippedReposPath = path.join(
            PLUGIN_STORING_PATH,
            `${reposName}-${extractedArchiveDirName}`,
          );

          try {
            // download github repository to local file system
            await this.download(archiveUrl, zipFilePath);
            await this.unzip(zipFilePath, unzippedPath);
            fs.renameSync(unzippedReposPath, pluginPath);
          } catch (err) {
            // clean up, documents are not operated
            if (fs.existsSync(unzippedReposPath))
              await fs.promises.rm(unzippedReposPath, { recursive: true });
            if (fs.existsSync(pluginPath))
              await fs.promises.rm(pluginPath, { recursive: true });
            logger.error(err);
          }
        }
      }
    } catch (err) {
      logger.error(err);
    }
  }

  /*
   * Install a plugin from URL and save it in the DB and file system.
   */
  async install(origin: IGrowiPluginOrigin): Promise<string> {
    const ghUrl = new GitHubUrl(origin.url, origin.ghBranch);
    const { organizationName, reposName, archiveUrl, extractedArchiveDirName } =
      ghUrl;

    const installedPath = `${organizationName}/${reposName}`;

    const organizationPath = this.joinAndValidatePath(
      PLUGIN_STORING_PATH,
      organizationName,
    );
    const zipFilePath = this.joinAndValidatePath(
      PLUGIN_STORING_PATH,
      organizationName,
      `${reposName}-${extractedArchiveDirName}.zip`,
    );
    const temporaryReposPath = this.joinAndValidatePath(
      PLUGIN_STORING_PATH,
      organizationName,
      `${reposName}-${extractedArchiveDirName}`,
    );
    const reposPath = this.joinAndValidatePath(
      PLUGIN_STORING_PATH,
      organizationName,
      reposName,
    );

    if (!fs.existsSync(organizationPath)) fs.mkdirSync(organizationPath);

    let plugins: IGrowiPlugin<IGrowiPluginMeta>[];

    try {
      // download github repository to file system's temporary path
      await this.download(archiveUrl, zipFilePath);
      await this.unzip(zipFilePath, organizationPath);

      // detect plugins
      plugins = await GrowiPluginService.detectPlugins(
        origin,
        organizationName,
        reposName,
        { packageRootPath: temporaryReposPath },
      );

      // remove the old repository from the storing path
      if (fs.existsSync(reposPath))
        await fs.promises.rm(reposPath, { recursive: true });

      // move new repository from temporary path to storing path.
      fs.renameSync(temporaryReposPath, reposPath);
    } catch (err) {
      logger.error(err);
      throw err;
    } finally {
      // clean up
      if (fs.existsSync(zipFilePath)) await fs.promises.rm(zipFilePath);
      if (fs.existsSync(temporaryReposPath))
        await fs.promises.rm(temporaryReposPath, { recursive: true });
    }

    try {
      // delete plugin documents if these exist
      await this.deleteOldPluginDocument(installedPath);

      // save new plugins metadata
      await this.savePluginMetaData(plugins);

      return plugins[0].meta.name;
    } catch (err) {
      // uninstall
      if (fs.existsSync(reposPath))
        await fs.promises.rm(reposPath, { recursive: true });
      await this.deleteOldPluginDocument(installedPath);

      logger.error(err);
      throw err;
    }
  }

  private async deleteOldPluginDocument(path: string): Promise<void> {
    await GrowiPlugin.deleteMany({ installedPath: path });
  }

  // !! DO NOT USE WHERE NOT SSRF GUARDED !! -- 2022.12.26 ryoji-s
  private async download(requestUrl: string, filePath: string): Promise<void> {
    return new Promise<void>((resolve, rejects) => {
      axios({
        method: 'GET',
        url: requestUrl,
        responseType: 'stream',
      })
        .then((res) => {
          if (res.status === 200) {
            const file = fs.createWriteStream(filePath);
            res.data
              .pipe(file)
              .on('close', () => file.close())
              .on('finish', () => {
                return resolve();
              });
          } else {
            rejects(res.status);
          }
        })
        .catch((err) => {
          logger.error(err);
          // eslint-disable-next-line prefer-promise-reject-errors
          rejects('Failed to download file.');
        });
    });
  }

  private async unzip(
    zipFilePath: fs.PathLike,
    destPath: fs.PathLike,
  ): Promise<void> {
    try {
      const readZipStream = fs.createReadStream(zipFilePath);
      await pipeline(
        readZipStream,
        unzipStream.Extract({ path: destPath.toString() }),
      );
    } catch (err) {
      logger.error(err);
      throw new Error('Failed to unzip.');
    }
  }

  private async savePluginMetaData(plugins: IGrowiPlugin[]): Promise<void> {
    await GrowiPlugin.insertMany(plugins);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, max-len
  private static async detectPlugins(
    origin: IGrowiPluginOrigin,
    ghOrganizationName: string,
    ghReposName: string,
    opts?: {
      packageRootPath?: string;
      parentPackageData?: GrowiPluginPackageData;
    },
  ): Promise<IGrowiPlugin[]> {
    const packageRootPath =
      opts?.packageRootPath ??
      path.resolve(PLUGIN_STORING_PATH, ghOrganizationName, ghReposName);

    // validate
    const validationData = await validateGrowiDirective(packageRootPath);

    const packageData =
      opts?.parentPackageData ?? importPackageJson(packageRootPath);

    const { growiPlugin } = validationData;
    const {
      name: packageName,
      description: packageDesc,
      author: packageAuthor,
    } = packageData;

    // detect sub plugins for monorepo
    if (growiPlugin.isMonorepo && growiPlugin.packages != null) {
      const plugins = await Promise.all(
        growiPlugin.packages.map(async (subPackagePath) => {
          return GrowiPluginService.detectPlugins(
            origin,
            ghOrganizationName,
            ghReposName,
            {
              packageRootPath: path.join(packageRootPath, subPackagePath),
              parentPackageData: packageData,
            },
          );
        }),
      );
      return plugins.flat();
    }

    const plugin: IGrowiPlugin = {
      isEnabled: true,
      installedPath: `${ghOrganizationName}/${ghReposName}`,
      organizationName: ghOrganizationName,
      origin,
      meta: {
        name: growiPlugin.name ?? packageName,
        desc: growiPlugin.desc ?? packageDesc,
        author: growiPlugin.author ?? packageAuthor,
        types: growiPlugin.types,
      },
    };

    // add theme metadata
    if (growiPlugin.types.includes(GrowiPluginType.Theme)) {
      plugin.meta = await generateThemePluginMeta(plugin, validationData);
    }
    // add template metadata
    if (growiPlugin.types.includes(GrowiPluginType.Template)) {
      plugin.meta = await generateTemplatePluginMeta(plugin, validationData);
    }

    logger.info('Plugin detected => ', plugin);

    return [plugin];
  }

  async listPlugins(): Promise<IGrowiPlugin[]> {
    return [];
  }

  /**
   * Delete plugin
   */
  async deletePlugin(pluginId: mongoose.Types.ObjectId): Promise<string> {
    const deleteFolder = (path: fs.PathLike): Promise<void> => {
      return fs.promises.rm(path, { recursive: true });
    };

    const growiPlugins = await GrowiPlugin.findById(pluginId);

    if (growiPlugins == null) {
      throw new Error('No plugin found for this ID.');
    }

    try {
      await GrowiPlugin.deleteOne({ _id: pluginId });
    } catch (err) {
      logger.error(err);
      throw new Error('Failed to delete plugin from GrowiPlugin documents.');
    }

    let growiPluginsPath: fs.PathLike | undefined;
    try {
      growiPluginsPath = this.joinAndValidatePath(
        PLUGIN_STORING_PATH,
        growiPlugins.installedPath,
      );
    } catch (err) {
      logger.error(err);
      throw new Error(
        'The installedPath for the plugin is invalid, and the plugin has already been removed.',
      );
    }

    if (growiPluginsPath && fs.existsSync(growiPluginsPath)) {
      try {
        await deleteFolder(growiPluginsPath);
      } catch (err) {
        logger.error(err);
        throw new Error('Failed to delete plugin repository.');
      }
    } else {
      logger.warn(`Plugin path does not exist : ${growiPluginsPath}`);
    }
    return growiPlugins.meta.name;
  }

  async findThemePlugin(theme: string): Promise<FindThemePluginResult | null> {
    let matchedPlugin: IGrowiPlugin | undefined;
    let matchedThemeMetadata: GrowiThemeMetadata | undefined;

    try {
      // retrieve plugin manifests
      const growiPlugins = await GrowiPlugin.findEnabledPluginsByType(
        GrowiPluginType.Theme,
      );

      growiPlugins.forEach((growiPlugin) => {
        const themeMetadatas = growiPlugin.meta.themes;
        const themeMetadata = themeMetadatas.find((t) => t.name === theme);

        // found
        if (themeMetadata != null) {
          matchedPlugin = growiPlugin;
          matchedThemeMetadata = themeMetadata;
        }
      });
    } catch (e) {
      logger.error(
        `Could not find the theme '${theme}' from GrowiPlugin documents.`,
        e,
      );
    }

    if (matchedPlugin == null || matchedThemeMetadata == null) {
      return null;
    }

    let themeHref: string | undefined;
    try {
      const manifest = retrievePluginManifest(matchedPlugin);
      if (manifest == null) {
        throw new Error('The manifest file does not exists');
      }
      themeHref = `${PLUGIN_EXPRESS_STATIC_DIR}/${matchedPlugin.installedPath}/dist/${manifest[matchedThemeMetadata.manifestKey].file}`;
    } catch (e) {
      logger.error(`Could not read manifest file for the theme '${theme}'`, e);
    }

    return {
      growiPlugin: matchedPlugin,
      themeMetadata: matchedThemeMetadata,
      themeHref,
    };
  }

  async retrieveAllPluginResourceEntries(): Promise<GrowiPluginResourceEntries> {
    const entries: GrowiPluginResourceEntries = [];

    try {
      const growiPlugins = await GrowiPlugin.findEnabledPlugins();

      growiPlugins.forEach(async (growiPlugin) => {
        try {
          const { types } = growiPlugin.meta;
          const manifest = await retrievePluginManifest(growiPlugin);

          if (manifest == null) {
            return;
          }

          // add script
          if (types.includes(GrowiPluginType.Script)) {
            const href = `${PLUGIN_EXPRESS_STATIC_DIR}/${growiPlugin.installedPath}/dist/${manifest['client-entry.tsx'].file}`;
            entries.push([growiPlugin.installedPath, href]);
          }
          // add link
          if (
            types.includes(GrowiPluginType.Script) ||
            types.includes(GrowiPluginType.Style)
          ) {
            const href = `${PLUGIN_EXPRESS_STATIC_DIR}/${growiPlugin.installedPath}/dist/${manifest['client-entry.tsx'].css}`;
            entries.push([growiPlugin.installedPath, href]);
          }
        } catch (e) {
          logger.warn(e);
        }
      });
    } catch (e) {
      logger.error('Could not retrieve GrowiPlugin documents.', e);
    }

    return entries;
  }

  private joinAndValidatePath(baseDir: string, ...paths: string[]): string {
    const joinedPath = path.join(baseDir, ...paths);
    if (!joinedPath.startsWith(baseDir)) {
      throw new Error(
        'Invalid plugin path detected! Access outside of the allowed directory is not permitted.' +
          `\nAttempted Path: ${joinedPath}`,
      );
    }
    return joinedPath;
  }
}

export const growiPluginService = new GrowiPluginService();
