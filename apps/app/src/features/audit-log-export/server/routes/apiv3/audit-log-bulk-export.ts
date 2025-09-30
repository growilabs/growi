// server/routes/apiv3/audit-log-bulk-export.ts
import type { IUser, IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import type { Scope } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { AuditLogExportFormat } from '../../../interfaces/audit-log-bulk-export';
import {
  DuplicateAuditLogExportJobError,
  auditLogExportService,
} from '../../service/audit-log-bulk-export-service';

const logger = loggerFactory('growi:routes:apiv3:audit-log-bulk-export');
const router = Router();

/** loginRequiredStrictly 通過後の req を想定 */
type AuthenticatedRequest = Request & { user: HydratedDocument<IUser> };

module.exports = (crowi: Crowi): Router => {
  const accessTokenParser = crowi.accessTokenParser;
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  const validators = {
    auditLogExport: [
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
        .isIn(Object.values(AuditLogExportFormat)),
      body('restartJob').isBoolean().optional(),
    ],
  };

  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.AUDIT_LOG_EXPORT]),
    loginRequiredStrictly,
    validators.auditLogExport,
    async(req: AuthenticatedRequest, res: ApiV3Response) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { filters, format = AuditLogExportFormat.json, restartJob } = req.body as {
        filters: {
          users?: string[];
          actions?: string[];
          dateFrom?: Date;
          dateTo?: Date;
        };
        format?: (typeof AuditLogExportFormat)[keyof typeof AuditLogExportFormat];
        restartJob?: boolean;
      };

      try {
        // サービスが IUserHasId を要求する場合に合わせてキャスト
        await auditLogExportService.createOrResetExportJob(
          filters,
          format,
          req.user as unknown as IUserHasId,
          restartJob,
        );
        return res.apiv3({}, 204);
      }
      catch (err) {
        logger.error(err);

        if (err instanceof DuplicateAuditLogExportJobError) {
          return res.apiv3Err(
            new ErrorV3(
              'Duplicate audit-log export job is in progress',
              'audit_log_export.duplicate_export_job_error',
              undefined,
              {
                duplicateJob: {
                  createdAt: err.duplicateJob.createdAt,
                  upperBoundAt: err.duplicateJob.upperBoundAt,
                },
              },
            ),
            409,
          );
        }

        return res.apiv3Err(
          new ErrorV3('Failed to start audit-log export', 'audit_log_export.failed_to_export'),
        );
      }
    },
  );

  return router;
};
