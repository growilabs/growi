import Esa from 'esa-node';

import loggerFactory from '~/utils/logger';

import { configManager } from '../service/config-manager';

const logger = loggerFactory('growi:util:importer');

/**
 * importer
 */

/* eslint-disable no-use-before-define */

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const createGrowiPages = require('./createGrowiPagesFromImports')(crowi);

  const importer = {};
  let esaClient = () => {};

  /**
   * Initialize importer
   */
  importer.initializeEsaClient = () => {
    const team = configManager.getConfig('importer:esa:team_name');
    const accessToken = configManager.getConfig('importer:esa:access_token');
    esaClient = new Esa(accessToken, team);
    logger.debug('initialize esa importer');
  };

  /**
   * Initialize importer
   */
  importer.initializeQiitaClient = () => {
    crowi.restQiitaAPIService.reset();
    logger.debug('initialize qiita importer');
  };

  /**
   * Import page data from esa to GROWI
   */
  importer.importDataFromEsa = (user) => {
    return new Promise((resolve, reject) => {
      const firstPage = 1;
      const errors = importPostsFromEsa(firstPage, user, []);

      resolve(errors);
    });
  };

  /**
   * post page data from esa and create GROWI page
   * @param {string} pageNum default value is '1'
   */
  const importPostsFromEsa = (pageNum, user, errors) => {
    return new Promise((resolve, reject) => {
      esaClient
        .posts({ page: pageNum, per_page: 100 })
        .then(async (res) => {
          const nextPage = res.next_page;
          const postsReceived = res.posts;

          const data = convertEsaDataForGrowi(postsReceived, user);
          const newErrors = await createGrowiPages(data);

          if (nextPage) {
            return resolve(
              importPostsFromEsa(nextPage, user, errors.concat(newErrors)),
            );
          }

          resolve(errors.concat(newErrors));
        })
        .catch((err) => {
          reject(new Error(`error in page ${pageNum}: ${err}`));
        });
    });
  };

  /**
   * Import page data from qiita to GROWI
   */
  importer.importDataFromQiita = async (user) => {
    const firstPage = 1;
    const errors = await importPostsFromQiita(firstPage, user, []);
    return errors;
  };

  /**
   * post page data from qiita and create GROWI page
   * @param {string} pageNum default value is '1'
   */
  const importPostsFromQiita = async (pageNum, user, errors) => {
    const perPage = '100';
    const res = await crowi.restQiitaAPIService.getQiitaPages(pageNum, perPage);
    const next = pageNum * perPage;
    const postsReceived = res.pages;
    const pageTotal = res.total;
    const data = convertQiitaDataForGrowi(postsReceived, user);

    const newErrors = await createGrowiPages(data);
    if (next < pageTotal) {
      return importPostsFromQiita(next, user, errors.concat(newErrors));
    }

    return errors.concat(newErrors);
  };

  /**
   * Convert data into usable format for createGrowiPagesFromImports
   */
  const convertEsaDataForGrowi = (pages, user) => {
    const basePage = '';
    const data = pages.map((post) => {
      const category = post.category;
      const name = post.name;

      let path = '';

      if (category && name) {
        path = `${category}/${name}`;
      } else if (category) {
        path = category;
      } else if (name) {
        path = name;
      }

      return {
        path: `${basePage}/${path}`,
        body: post.body_md,
        user,
      };
    });

    return data;
  };

  /**
   * Convert data into usable format for createGrowiPagesFromImports
   */
  const convertQiitaDataForGrowi = (pages, user) => {
    const basePage = '';
    const data = pages.map((post) => {
      const title = post.title;
      const path = title;

      return {
        path: `${basePage}/${path}`,
        body: post.body,
        user,
      };
    });

    return data;
  };

  /**
   * Import page data from esa to GROWI
   */
  importer.testConnectionToEsa = async () => {
    await getTeamNameFromEsa();
  };

  /**
   * Import page data from qiita to GROWI
   */
  importer.testConnectionToQiita = async () => {
    await crowi.restQiitaAPIService.getQiitaUser();
  };

  /**
   * Get teams from esa (Promise wrapper)
   */
  const getTeamNameFromEsa = () => {
    return new Promise((resolve, reject) => {
      const team = configManager.getConfig('importer:esa:team_name');
      esaClient
        .team(team)
        .then((res) => {
          resolve(res);
        })
        .catch((err) => {
          return reject(err);
        });
    });
  };

  // initialize when server starts
  importer.initializeEsaClient();
  importer.initializeQiitaClient();

  return importer;
};
