import fs, { readFileSync } from 'fs';
import path from 'path';

import { GrowiThemeMetadata, ViteManifest } from '@growi/core';
// eslint-disable-next-line no-restricted-imports
import axios from 'axios';
import mongoose from 'mongoose';
import streamToPromise from 'stream-to-promise';
import unzipper from 'unzipper';

import {
  GrowiPlugin, GrowiPluginOrigin, GrowiPluginResourceType, GrowiThemePluginMeta, GrowiPluginMeta,
} from '~/interfaces/plugin';
import loggerFactory from '~/utils/logger';
import { resolveFromRoot } from '~/utils/project-dir-utils';

import type { GrowiPluginModel } from '../models/growi-plugin';

const logger = loggerFactory('growi:plugins:plugin-utils');

const pluginStoringPath = resolveFromRoot('tmp/plugins');

// https://regex101.com/r/fK2rV3/1
const githubReposIdPattern = new RegExp(/^\/([^/]+)\/([^/]+)$/);

const PLUGINS_STATIC_DIR = '/static/plugins'; // configured by express.static

export type GrowiPluginResourceEntries = [installedPath: string, href: string][];

function retrievePluginManifest(growiPlugin: GrowiPlugin): ViteManifest {
  const manifestPath = resolveFromRoot(path.join('tmp/plugins', growiPlugin.installedPath, 'dist/manifest.json'));
  const manifestStr: string = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(manifestStr);
}

export interface IPluginService {
  install(origin: GrowiPluginOrigin): Promise<string>
  retrieveThemeHref(theme: string): Promise<string | undefined>
  retrieveAllPluginResourceEntries(): Promise<GrowiPluginResourceEntries>
  downloadNotExistPluginRepositories(): Promise<void>
}

export class PluginService implements IPluginService {

  /*
  * Downloading a non-existent repository to the file system
  */
  async downloadNotExistPluginRepositories(): Promise<void> {
    try {
      // find all growi plugin documents
      const GrowiPlugin = mongoose.model<GrowiPlugin>('GrowiPlugin');
      const growiPlugins = await GrowiPlugin.find({});

      // if not exists repository in file system, download latest plugin repository
      for await (const growiPlugin of growiPlugins) {
        const pluginPath = path.join(pluginStoringPath, growiPlugin.installedPath);
        if (fs.existsSync(pluginPath)) {
          continue;
        }
        else {
          // TODO: imprv Document version and repository version possibly different.
          const ghUrl = new URL(growiPlugin.origin.url);
          const ghPathname = ghUrl.pathname;
          // TODO: Branch names can be specified.
          const ghBranch = 'main';
          const match = ghPathname.match(githubReposIdPattern);
          if (ghUrl.hostname !== 'github.com' || match == null) {
            throw new Error('GitHub repository URL is invalid.');
          }

          const ghOrganizationName = match[1];
          const ghReposName = match[2];

          const requestUrl = `https://github.com/${ghOrganizationName}/${ghReposName}/archive/refs/heads/${ghBranch}.zip`;
          const zipFilePath = path.join(pluginStoringPath, `${ghBranch}.zip`);
          const unzippedPath = pluginStoringPath;
          const unzippedReposPath = path.join(pluginStoringPath, `${ghReposName}-${ghBranch}`);

          try {
            // download github repository to local file system
            await this.download(requestUrl, zipFilePath);
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
  async install(origin: GrowiPluginOrigin): Promise<string> {
    const ghUrl = new URL(origin.url);
    const ghPathname = ghUrl.pathname;
    // TODO: Branch names can be specified.
    const ghBranch = 'main';

    const match = ghPathname.match(githubReposIdPattern);
    if (ghUrl.hostname !== 'github.com' || match == null) {
      throw new Error('GitHub repository URL is invalid.');
    }

    const ghOrganizationName = match[1];
    const ghReposName = match[2];
    const installedPath = `${ghOrganizationName}/${ghReposName}`;

    const requestUrl = `https://github.com/${ghOrganizationName}/${ghReposName}/archive/refs/heads/${ghBranch}.zip`;
    const zipFilePath = path.join(pluginStoringPath, `${ghBranch}.zip`);
    const unzippedPath = pluginStoringPath;
    const unzippedReposPath = path.join(pluginStoringPath, `${ghReposName}-${ghBranch}`);
    const temporaryReposPath = path.join(pluginStoringPath, ghReposName);
    const reposStoringPath = path.join(pluginStoringPath, `${installedPath}`);


    let plugins: GrowiPlugin<GrowiPluginMeta>[];

    try {
      // download github repository to file system's temporary path
      await this.download(requestUrl, zipFilePath);
      await this.unzip(zipFilePath, unzippedPath);
      fs.renameSync(unzippedReposPath, temporaryReposPath);

      // detect plugins
      plugins = await PluginService.detectPlugins(origin, ghOrganizationName, ghReposName);

      // remove the old repository from the storing path
      if (fs.existsSync(reposStoringPath)) await fs.promises.rm(reposStoringPath, { recursive: true });

      // move new repository from temporary path to storing path.
      fs.renameSync(temporaryReposPath, reposStoringPath);
    }
    catch (err) {
      // clean up
      if (fs.existsSync(zipFilePath)) await fs.promises.rm(zipFilePath);
      if (fs.existsSync(unzippedReposPath)) await fs.promises.rm(unzippedReposPath, { recursive: true });
      if (fs.existsSync(temporaryReposPath)) await fs.promises.rm(temporaryReposPath, { recursive: true });
      logger.error(err);
      throw err;
    }

    try {
      // delete plugin documents if these exist
      await this.deleteOldPluginDocument(installedPath);

      // save new plugins metadata
      await this.savePluginMetaData(plugins);

      return plugins[0].meta.name;
    }
    catch (err) {
      // clean up
      if (fs.existsSync(reposStoringPath)) await fs.promises.rm(reposStoringPath, { recursive: true });
      await this.deleteOldPluginDocument(installedPath);
      logger.error(err);
      throw err;
    }
  }

  private async deleteOldPluginDocument(path: string): Promise<void> {
    const GrowiPlugin = mongoose.model<GrowiPlugin>('GrowiPlugin');
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
          rejects('Filed to download file.');
        });
    });
  }

  private async unzip(zipFilePath: fs.PathLike, unzippedPath: fs.PathLike): Promise<void> {
    try {
      const stream = fs.createReadStream(zipFilePath);
      const unzipStream = stream.pipe(unzipper.Extract({ path: unzippedPath }));

      await streamToPromise(unzipStream);
      await fs.promises.rm(zipFilePath);
    }
    catch (err) {
      logger.error(err);
      throw new Error('Filed to unzip.');
    }
  }

  private async savePluginMetaData(plugins: GrowiPlugin[]): Promise<void> {
    const GrowiPlugin = mongoose.model('GrowiPlugin');
    await GrowiPlugin.insertMany(plugins);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, max-len
  private static async detectPlugins(origin: GrowiPluginOrigin, ghOrganizationName: string, ghReposName: string, parentPackageJson?: any): Promise<GrowiPlugin[]> {
    const packageJsonPath = path.resolve(pluginStoringPath, ghReposName, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    const { growiPlugin } = packageJson;
    const {
      name: packageName, description: packageDesc, author: packageAuthor,
    } = parentPackageJson ?? packageJson;


    if (growiPlugin == null) {
      throw new Error('This package does not include \'growiPlugin\' section.');
    }

    // detect sub plugins for monorepo
    if (growiPlugin.isMonorepo && growiPlugin.packages != null) {
      const plugins = await Promise.all(
        growiPlugin.packages.map(async(subPackagePath) => {
          const subPackageInstalledPath = path.join(ghReposName, subPackagePath);
          return this.detectPlugins(origin, subPackageInstalledPath, packageJson);
        }),
      );
      return plugins.flat();
    }

    if (growiPlugin.types == null) {
      throw new Error('\'growiPlugin\' section must have a \'types\' property.');
    }
    const plugin = {
      isEnabled: true,
      installedPath: `${ghOrganizationName}/${ghReposName}`,
      origin,
      meta: {
        name: growiPlugin.name ?? packageName,
        desc: growiPlugin.desc ?? packageDesc,
        author: growiPlugin.author ?? packageAuthor,
        types: growiPlugin.types,
      },
    };

    // add theme metadata
    if (growiPlugin.types.includes(GrowiPluginResourceType.Theme)) {
      (plugin as GrowiPlugin<GrowiThemePluginMeta>).meta = {
        ...plugin.meta,
        themes: growiPlugin.themes,
      };
    }

    logger.info('Plugin detected => ', plugin);

    return [plugin];
  }

  async listPlugins(): Promise<GrowiPlugin[]> {
    return [];
  }

  /**
   * Delete plugin
   */
  async deletePlugin(pluginId: mongoose.Types.ObjectId): Promise<string> {
    const deleteFolder = (path: fs.PathLike): Promise<void> => {
      return fs.promises.rm(path, { recursive: true });
    };

    const GrowiPlugin = mongoose.model<GrowiPlugin>('GrowiPlugin');
    const growiPlugins = await GrowiPlugin.findById(pluginId);

    if (growiPlugins == null) {
      throw new Error('No plugin found for this ID.');
    }

    try {
      const growiPluginsPath = path.join(pluginStoringPath, growiPlugins.installedPath);
      await deleteFolder(growiPluginsPath);
    }
    catch (err) {
      logger.error(err);
      throw new Error('Filed to delete plugin repository.');
    }

    try {
      await GrowiPlugin.deleteOne({ _id: pluginId });
    }
    catch (err) {
      logger.error(err);
      throw new Error('Filed to delete plugin from GrowiPlugin documents.');
    }

    return growiPlugins.meta.name;
  }

  async retrieveThemeHref(theme: string): Promise<string | undefined> {

    const GrowiPlugin = mongoose.model('GrowiPlugin') as GrowiPluginModel;

    let matchedPlugin: GrowiPlugin | undefined;
    let matchedThemeMetadata: GrowiThemeMetadata | undefined;

    try {
      // retrieve plugin manifests
      const growiPlugins = await GrowiPlugin.findEnabledPluginsIncludingAnyTypes([GrowiPluginResourceType.Theme]) as GrowiPlugin<GrowiThemePluginMeta>[];

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

    try {
      if (matchedPlugin != null && matchedThemeMetadata != null) {
        const manifest = await retrievePluginManifest(matchedPlugin);
        return `${PLUGINS_STATIC_DIR}/${matchedPlugin.installedPath}/dist/${manifest[matchedThemeMetadata.manifestKey].file}`;
      }
    }
    catch (e) {
      logger.error(`Could not read manifest file for the theme '${theme}'`, e);
    }
  }

  async retrieveAllPluginResourceEntries(): Promise<GrowiPluginResourceEntries> {

    const GrowiPlugin = mongoose.model('GrowiPlugin') as GrowiPluginModel;

    const entries: GrowiPluginResourceEntries = [];

    try {
      const growiPlugins = await GrowiPlugin.findEnabledPlugins();

      growiPlugins.forEach(async(growiPlugin) => {
        try {
          const { types } = growiPlugin.meta;
          const manifest = await retrievePluginManifest(growiPlugin);

          // add script
          if (types.includes(GrowiPluginResourceType.Script) || types.includes(GrowiPluginResourceType.Template)) {
            const href = `${PLUGINS_STATIC_DIR}/${growiPlugin.installedPath}/dist/${manifest['client-entry.tsx'].file}`;
            entries.push([growiPlugin.installedPath, href]);
          }
          // add link
          if (types.includes(GrowiPluginResourceType.Script) || types.includes(GrowiPluginResourceType.Style)) {
            const href = `${PLUGINS_STATIC_DIR}/${growiPlugin.installedPath}/dist/${manifest['client-entry.tsx'].css}`;
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
