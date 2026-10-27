import { addHours } from 'date-fns/addHours';
import { isAfter } from 'date-fns/isAfter';
import type { Router } from 'express';
import express from 'express';

import type Crowi from '~/server/crowi';
import axios from '~/utils/axios';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import type { ContributorSection } from './contributors';

const logger = loggerFactory('growi:routes:apiv3:staffs');

const router = express.Router();

// Sorting contributors by this method
const compareFunction = (
  a: ContributorSection,
  b: ContributorSection,
): number => a.order - b.order;

// Lazily-populated, GROWI.cloud-merged contributor list. Kept at module scope so
// the merge result and the 1-hour expiry survive across requests. It starts null
// so the (rarely used) static contributor dataset is loaded via dynamic import on
// the first request only — never at server boot. See no-eager-contributors-import.spec.ts.
let contributorsCache: ContributorSection[] | null = null;
let isGrowiCloudMerged = false;
let expiredAt: Date | null = null;

export const setup = (crowi: Crowi): Router => {
  router.get('/', async (_req, res: ApiV3Response) => {
    const now = new Date();
    const growiCloudUri = crowi.configManager.getConfig('app:growiCloudUri');

    if (contributorsCache == null) {
      const { contributors } = await import('./contributors');
      contributorsCache = contributors;
    }

    if (
      growiCloudUri != null &&
      (expiredAt == null || isAfter(now, expiredAt))
    ) {
      const url = new URL('_api/staffCredit', growiCloudUri);
      try {
        const gcContributorsRes = await axios.get(url.toString());
        if (!isGrowiCloudMerged) {
          // Merge GROWI.cloud contributors once, immutably (never mutate the
          // imported dataset), then keep the combined list ordered.
          contributorsCache = [
            ...contributorsCache,
            gcContributorsRes.data,
          ].sort(compareFunction);
          isGrowiCloudMerged = true;
        }
        // caching 'expiredAt' for 1 hour
        expiredAt = addHours(now, 1);
      } catch (_err) {
        logger.warn('Getting GROWI.cloud staffcredit is failed');
      }
    }
    return res.apiv3({ contributors: contributorsCache });
  });

  return router;
};
