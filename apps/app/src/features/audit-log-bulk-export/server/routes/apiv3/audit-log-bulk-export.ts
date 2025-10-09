import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';
import { Router } from 'express';
import { body, validationResult } from 'express-validator';

import { AuditLogBulkExportFormat } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import {
  DuplicateAuditLogBulkExportJobError,
  auditLogBulkExportService,
} from '../../service/audit-log-bulk-export';

const logger = loggerFactory('growi:routes:apiv3:audit-log-bulk-export');

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
    auditLogBulkExport: [
      body('filters').exists({ checkFalsy: true }).isObject(),
      body('filters.users').optional({ nullable: true }).isArray(),
      body('filters.users.*').optional({ nullable: true }).isString(),
      body('filters.actions').optional({ nullable: true }).isArray(),
      body('filters.actions.*').optional({ nullable: true }).isString(),
      body('filters.dateFrom').optional({ nullable: true }).isISO8601().toDate(),
      body('filters.dateTo').optional({ nullable: true }).isISO8601().toDate(),
      body('format')
        .optional({ nullable: true })
        .isString()
        .isIn(Object.values(AuditLogBulkExportFormat)),
      body('restartJob').isBoolean().optional(),
    ],
  };
  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.ADMIN.AUDIT_LOG]),
    loginRequiredStrictly,
    validators.auditLogBulkExport,
    async(req: AuthorizedRequest, res: ApiV3Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { filters, format = AuditLogBulkExportFormat.json, restartJob } = req.body as {
        filters: {
          users?: string[];
          actions?: string[];
          dateFrom?: Date;
          dateTo?: Date;
        };
        format?: (typeof AuditLogBulkExportFormat)[keyof typeof AuditLogBulkExportFormat];
        restartJob?: boolean;
      };

      try {
        await auditLogBulkExportService.createOrResetExportJob(
          filters,
          format,
          req.user,
          restartJob,
        );
        return res.apiv3({}, 204);
      }
      catch (err) {
        logger.error(err);

        if (err instanceof DuplicateAuditLogBulkExportJobError) {
          return res.apiv3Err(
            new ErrorV3(
              'Duplicate audit-log bulk export job is in progress',
              'audit_log_bulk_export.duplicate_export_job_error',
              undefined,
              {
                duplicateJob: {
                  createdAt: err.duplicateJob.createdAt,
                },
              },
            ),
            409,
          );
        }

        return res.apiv3Err(
          new ErrorV3('Failed to start audit-log bulk export', 'audit_log_bulk_export.failed_to_export'),
        );
      }
    },
  );
  return router;
};
