import fs, { readFileSync } from 'fs';
import path from 'path';

import { GrowiPluginType, type GrowiThemeMetadata, type ViteManifest } from '@growi/core';
import type { GrowiPluginPackageData } from '@growi/pluginkit';
import { importPackageJson, validateGrowiDirective } from '@growi/pluginkit/dist/v4/server';
// eslint-disable-next-line no-restricted-imports
import axios from 'axios';
import mongoose from 'mongoose';
import sanitize from 'sanitize-filename';
import streamToPromise from 'stream-to-promise';
import unzipper from 'unzipper';

import loggerFactory from '~/utils/logger';

import type {
  IGrowiPlugin, IGrowiPluginOrigin, IGrowiPluginMeta,
} from '../../../interfaces';
import { PLUGIN_EXPRESS_STATIC_DIR, PLUGIN_STORING_PATH } from '../../consts';
import { GrowiPlugin } from '../../models';
import { GitHubUrl } from '../../models/vo/github-url';

import { generateTemplatePluginMeta } from './generate-template-plugin-meta';
import { generateThemePluginMeta } from './generate-theme-plugin-meta';

const logger = loggerFactory('growi:plugins:plugin-utils');

export type GrowiPluginResourceEntries = [installedPath: string, href: string][];

function retrievePluginManifest(growiPlugin: IGrowiPlugin): ViteManifest | undefined {
  const manifestPath = path.join(PLUGIN_STORING_PATH, growiPlugin.installedPath, 'dist/manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return;
  }

  const manifestStr: string = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(manifestStr);
}


type FindThemePluginResult = {
  growiPlugin: IGrowiPlugin,
  themeMetadata: GrowiThemeMetadata,
  themeHref: string,
}

export interface IGrowiPluginService {
  install(origin: IGrowiPluginOrigin): Promise<string>
  findThemePlugin(theme: string): Promise<FindThemePluginResult | null>
  retrieveAllPluginResourceEntries(): Promise<GrowiPluginResourceEntries>
  downloadNotExistPluginRepositories(): Promise<void>
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
        const pluginPath = path.join(PLUGIN_STORING_PATH, growiPlugin.installedPath);
        const organizationName = path.join(PLUGIN_STORING_PATH, growiPlugin.organizationName);
        if (fs.existsSync(pluginPath)) {
          continue;
        }
        else {
          if (!fs.existsSync(organizationName)) {
            fs.mkdirSync(organizationName);
          }

          // TODO: imprv Document version and repository version possibly different.
          const ghUrl = new GitHubUrl(growiPlugin.origin.url, growiPlugin.origin.ghBranch);
          const { reposName, branchName, archiveUrl } = ghUrl;

          const zipFilePath = path.join(PLUGIN_STORING_PATH, `${branchName}.zip`);
          const unzippedPath = PLUGIN_STORING_PATH;
          const unzippedReposPath = path.join(PLUGIN_STORING_PATH, `${reposName}-${branchName}`);

          try {
            // download github repository to local file system
            await this.download(archiveUrl, zipFilePath);
            await this.unzip(zipFilePath, unzippedPath);
            fs.renameSync(unzippedReposPath, pluginPath);
          }
          catch (err) {
            // clean up, documents are not operated
            if (fs.existsSync(unzippedReposPath)) await fs.promises.rm(unzippedReposPath, { recursive: true });
            if (fs.existsSync(pluginPath)) await fs.promises.rm(pluginPath, { recursive: true });
            logger.error(err);
          }

          continue;
        }
      }
    }
    catch (err) {
      logger.error(err);
    }
  }

  /*
  * Install a plugin from URL and save it in the DB and file system.
  */
  async install(origin: IGrowiPluginOrigin): Promise<string> {
    const ghUrl = new GitHubUrl(origin.url, origin.ghBranch);
    const {
      organizationName, reposName, branchName, archiveUrl,
    } = ghUrl;

    const sanitizedBranchName = sanitize(branchName);

    const installedPath = `${organizationName}/${reposName}`;

    const organizationPath = path.join(PLUGIN_STORING_PATH, organizationName);
    const zipFilePath = path.join(organizationPath, `${reposName}-${sanitizedBranchName}.zip`);
    const temporaryReposPath = path.join(organizationPath, `${reposName}-${sanitizedBranchName}`);
    const reposPath = path.join(organizationPath, reposName);

    if (!fs.existsSync(organizationPath)) fs.mkdirSync(organizationPath);

    let plugins: IGrowiPlugin<IGrowiPluginMeta>[];

    try {
      // download github repository to file system's temporary path
      await this.download(archiveUrl, zipFilePath);
      await this.unzip(zipFilePath, organizationPath);

      // detect plugins
      plugins = await GrowiPluginService.detectPlugins(origin, organizationName, reposName, { packageRootPath: temporaryReposPath });

      // remove the old repository from the storing path
      if (fs.existsSync(reposPath)) await fs.promises.rm(reposPath, { recursive: true });

      // move new repository from temporary path to storing path.
      fs.renameSync(temporaryReposPath, reposPath);
    }
    catch (err) {
      logger.error(err);
      throw err;
    }
    finally {
      // clean up
      if (fs.existsSync(zipFilePath)) await fs.promises.rm(zipFilePath);
      if (fs.existsSync(temporaryReposPath)) await fs.promises.rm(temporaryReposPath, { recursive: true });
    }

    try {
      // delete plugin documents if these exist
      await this.deleteOldPluginDocument(installedPath);

      // save new plugins metadata
      await this.savePluginMetaData(plugins);

      return plugins[0].meta.name;
    }
    catch (err) {
      // uninstall
      if (fs.existsSync(reposPath)) await fs.promises.rm(reposPath, { recursive: true });
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
            res.data.pipe(file)
              .on('close', () => file.close())
              .on('finish', () => {
                return resolve();
              });
          }
          else {
            rejects(res.status);
          }
        }).catch((err) => {
          logger.error(err);
          // eslint-disable-next-line prefer-promise-reject-errors
          rejects('Failed to download file.');
        });
    });
  }

  private async unzip(zipFilePath: fs.PathLike, destPath: fs.PathLike): Promise<void> {
    try {
      const stream = fs.createReadStream(zipFilePath);
      const unzipStream = stream.pipe(unzipper.Extract({ path: destPath }));

      await streamToPromise(unzipStream);
    }
    catch (err) {
      logger.error(err);
      throw new Error('Failed to unzip.');
    }
  }

  private async savePluginMetaData(plugins: IGrowiPlugin[]): Promise<void> {
    await GrowiPlugin.insertMany(plugins);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, max-len
  private static async detectPlugins(
      origin: IGrowiPluginOrigin, ghOrganizationName: string, ghReposName: string,
      opts?: {
        packageRootPath?: string,
        parentPackageData?: GrowiPluginPackageData,
      },
  ): Promise<IGrowiPlugin[]> {
    const packageRootPath = opts?.packageRootPath ?? path.resolve(PLUGIN_STORING_PATH, ghOrganizationName, ghReposName);

    // validate
    const validationData = await validateGrowiDirective(packageRootPath);

    const packageData = opts?.parentPackageData ?? importPackageJson(packageRootPath);

    const { growiPlugin } = validationData;
    const {
      name: packageName, description: packageDesc, author: packageAuthor,
    } = packageData;

    // detect sub plugins for monorepo
    if (growiPlugin.isMonorepo && growiPlugin.packages != null) {
      const plugins = await Promise.all(
        growiPlugin.packages.map(async(subPackagePath) => {
          return this.detectPlugins(origin, ghOrganizationName, ghReposName, {
            packageRootPath: path.join(packageRootPath, subPackagePath),
            parentPackageData: packageData,
          });
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
      const growiPluginsPath = path.join(PLUGIN_STORING_PATH, growiPlugins.installedPath);
      await deleteFolder(growiPluginsPath);
    }
    catch (err) {
      logger.error(err);
      throw new Error('Failed to delete plugin repository.');
    }

    try {
      await GrowiPlugin.deleteOne({ _id: pluginId });
    }
    catch (err) {
      logger.error(err);
      throw new Error('Failed to delete plugin from GrowiPlugin documents.');
    }

    return growiPlugins.meta.name;
  }

  async findThemePlugin(theme: string): Promise<FindThemePluginResult | null> {
    let matchedPlugin: IGrowiPlugin | undefined;
    let matchedThemeMetadata: GrowiThemeMetadata | undefined;

    try {
      // retrieve plugin manifests
      const growiPlugins = await GrowiPlugin.findEnabledPluginsByType(GrowiPluginType.Theme);

      growiPlugins
        .forEach(async(growiPlugin) => {
          const themeMetadatas = growiPlugin.meta.themes;
          const themeMetadata = themeMetadatas.find(t => t.name === theme);

          // found
          if (themeMetadata != null) {
            matchedPlugin = growiPlugin;
            matchedThemeMetadata = themeMetadata;
          }
        });
    }
    catch (e) {
      logger.error(`Could not find the theme '${theme}' from GrowiPlugin documents.`, e);
    }

    if (matchedPlugin == null || matchedThemeMetadata == null) {
      return null;
    }

    let themeHref;
    try {
      const manifest = retrievePluginManifest(matchedPlugin);
      if (manifest == null) {
        throw new Error('The manifest file does not exists');
      }
      themeHref = `${PLUGIN_EXPRESS_STATIC_DIR}/${matchedPlugin.installedPath}/dist/${manifest[matchedThemeMetadata.manifestKey].file}`;
    }
    catch (e) {
      logger.error(`Could not read manifest file for the theme '${theme}'`, e);
    }

    return { growiPlugin: matchedPlugin, themeMetadata: matchedThemeMetadata, themeHref };
  }

  async retrieveAllPluginResourceEntries(): Promise<GrowiPluginResourceEntries> {

    const entries: GrowiPluginResourceEntries = [];

    try {
      const growiPlugins = await GrowiPlugin.findEnabledPlugins();

      growiPlugins.forEach(async(growiPlugin) => {
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
          if (types.includes(GrowiPluginType.Script) || types.includes(GrowiPluginType.Style)) {
            const href = `${PLUGIN_EXPRESS_STATIC_DIR}/${growiPlugin.installedPath}/dist/${manifest['client-entry.tsx'].css}`;
            entries.push([growiPlugin.installedPath, href]);
          }
        }
        catch (e) {
          logger.warn(e);
        }
      });
    }
    catch (e) {
      logger.error('Could not retrieve GrowiPlugin documents.', e);
    }

    return entries;
  }

}


export const growiPluginService = new GrowiPluginService();
