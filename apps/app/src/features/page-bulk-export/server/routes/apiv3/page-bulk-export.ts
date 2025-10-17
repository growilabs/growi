import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';
import { Router } from 'express';
import { body, validationResult } from 'express-validator';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import {
  DuplicateBulkExportJobError,
  pageBulkExportService,
} from '../../service/page-bulk-export';

const logger = loggerFactory('growi:routes:apiv3:page-bulk-export');

const router = Router();

interface AuthorizedRequest extends Request {
  user?: any;
}

module.exports = (crowi: Crowi): Router => {
  const accessTokenParser = crowi.accessTokenParser;
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validators = {
    pageBulkExport: [
      body('path').exists({ checkFalsy: true }).isString(),
      body('format').exists({ checkFalsy: true }).isString(),
      body('restartJob').isBoolean().optional(),
    ],
  };

  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE_BULK_EXPORT]),
    loginRequiredStrictly,
    validators.pageBulkExport,
    async (req: AuthorizedRequest, res: ApiV3Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { path, format, restartJob } = req.body;

      try {
        await pageBulkExportService?.createOrResetBulkExportJob(
          path,
          format,
          req.user,
          restartJob,
        );
        return res.apiv3({}, 204);
      } catch (err) {
        logger.error(err);
        if (err instanceof DuplicateBulkExportJobError) {
          return res.apiv3Err(
            new ErrorV3(
              'Duplicate bulk export job is in progress',
              'page_export.duplicate_bulk_export_job_error',
              undefined,
              { duplicateJob: { createdAt: err.duplicateJob.createdAt } },
            ),
            409,
          );
        }
        return res.apiv3Err(
          new ErrorV3(
            'Failed to start bulk export',
            'page_export.failed_to_export',
          ),
        );
      }
    },
  );

  return router;
};
