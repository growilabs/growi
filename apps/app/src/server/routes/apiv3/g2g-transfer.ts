import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request, Router } from 'express';
import express from 'express';
import { body } from 'express-validator';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'pathe';

import { isCoherentOptionsMap } from '~/models/admin/g2g-transfer-preset';
import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import {
  G2G_CONFLICT_DETECTION_FAILED_ERROR_CODE,
  G2G_DATA_CONFLICT_ERROR_CODE,
  G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
  G2G_IMPORT_SETTINGS_INVALID_ERROR_CODE,
  G2G_INVALID_TRANSFER_KEY_ERROR_CODE,
  G2G_MIXED_IMPORT_MODES_ERROR_CODE,
  G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE,
  G2G_PARSE_FAILED_ERROR_CODE,
  G2G_PROTECTED_COLLECTION_ERROR_CODE,
  G2G_VALIDATION_FAILED_ERROR_CODE,
  G2G_VERSION_INCOMPATIBLE_ERROR_CODE,
  G2GTransferErrorCode,
  isG2GTransferError,
} from '~/server/models/vo/g2g-transfer-error';
import { configManager } from '~/server/service/config-manager';
import { exportService } from '~/server/service/export';
import type {
  IDataGROWIInfo,
  ImportCollectionsResult,
} from '~/server/service/g2g-transfer';
import { X_GROWI_TRANSFER_KEY_HEADER_NAME } from '~/server/service/g2g-transfer';
import type { ImportSettings } from '~/server/service/import';
import { getImportService } from '~/server/service/import';
import type { UniqueConflictReport } from '~/server/service/import/detect-unique-conflicts';
import { hasConflicts } from '~/server/service/import/detect-unique-conflicts';
import type { ImportJobLease } from '~/server/service/import/import';
import {
  excludeNonTransferableCollections,
  NON_TRANSFERABLE_COLLECTIONS,
  selectTransferableCollections,
} from '~/server/service/import/non-transferable-collections';
import { deriveReplaceTargets } from '~/server/service/import/replace-target-collections';
import { summarizeUniqueConflicts } from '~/server/service/import/summarize-unique-conflicts';
import loggerFactory from '~/utils/logger';
import { TransferKey } from '~/utils/vo/transfer-key';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import { Attachment } from '../../models/attachment';
import { isPathWithinBase } from '../../util/safe-path-utils';
import { generateAdminRequiredIfInstalled } from './g2g-transfer-admin-required-if-installed';
import { validateAttachmentMetadata } from './g2g-transfer-attachment-metadata';
import type { ApiV3Response } from './interfaces/apiv3-response';

interface AuthorizedRequest extends Request {
  user?: any;
}

const logger = loggerFactory('growi:routes:apiv3:transfer');

/**
 * Removes the archive multer wrote for this request.
 *
 * Nothing else does: the receive route unzips in place, and the only sweep of the import
 * directory — `deleteAllZipFiles` — is reachable from the admin import screen alone. Since
 * each transfer now lands under a name of its own (it used to overwrite the previous one
 * by accident), a wiki transferred twice would otherwise cost twice its size on the
 * destination's disk, for good.
 *
 * Only this request's file, by the exact path multer chose, never a sweep of the shared
 * directory: another request may be uploading into it at the same time. The JSON files
 * extracted from the archive are a separate matter — `importCollection` deletes each one
 * it finishes with.
 */
const deleteReceivedArchive = async (
  baseDir: string,
  file?: { path?: string },
): Promise<void> => {
  if (file?.path == null) {
    return;
  }

  // multer composed this path from the `filename` callback below — a UUID plus the
  // extension — so nothing the caller sent reaches it. Checked against the import
  // directory anyway: this is a delete, and the cost of being wrong once is a file
  // removed from somewhere else. The same guard the attachment route applies before it
  // reads an uploaded file, and what the path-traversal analysis in CI looks for, since
  // it cannot see through multer's storage configuration.
  const resolvedPath = path.resolve(file.path);
  if (!isPathWithinBase(resolvedPath, baseDir)) {
    logger.error(
      { path: resolvedPath, baseDir },
      'Refused to delete a received archive from outside the import directory',
    );
    return;
  }

  try {
    // `force`, so a file multer already cleaned up after a failed upload is not an error.
    await rm(resolvedPath, { force: true });
  } catch (err) {
    // A transfer that worked must not be reported as failed because the leftover archive
    // could not be removed; the operator is left with a file to delete, not a false alarm.
    logger.warn(
      { err, path: resolvedPath },
      'Failed to delete the received transfer archive',
    );
  }
};

const validator = {
  transfer: [
    body('transferKey').isString().withMessage('transferKey is required'),
    body('collections').isArray().withMessage('collections is required'),
    body('optionsMap').isObject().withMessage('optionsMap is required'),
  ],
  preflight: [
    body('transferKey').isString().withMessage('transferKey is required'),
  ],
};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      GrowiInfo:
 *        type: object
 *        properties:
 *           version:
 *             type: string
 *             description: The version of the GROWI
 *           userUpperLimit:
 *             type: number
 *             description: The upper limit of the number of users
 *           fileUploadTotalLimit:
 *             type: number
 *             description: The total limit of the file upload size
 *           destinationCounts:
 *             type: object
 *             description: How much data this GROWI holds, all of which a migration transfer deletes
 *             properties:
 *               users:
 *                 type: number
 *               userGroups:
 *                 type: number
 *               pages:
 *                 type: number
 *           passwordSeedFingerprint:
 *             type: string
 *             description: One-way hash of this GROWI's password seed. The seed itself is never sent.
 *           loginableAdminCount:
 *             type: number
 *             description: Administrators that are in an active status and have a password
 *           sessionStoreSupportsEnumeration:
 *             type: boolean
 *             description: Whether the sessions of replaced users can be invalidated on this GROWI
 *           attachmentInfo:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *               writable:
 *                 type: boolean
 *               bucket:
 *                 type: string
 *               customEndpoint:
 *                 type: string
 *               uploadNamespace:
 *                 type: string
 *               accountName:
 *                 type: string
 *               containerName:
 *                 type: string
 */
/*
 * Routes
 */
export const setup = (crowi: Crowi): Router => {
  /**
   * The import claim `requireImportJob` took for a request, from the moment the
   * middleware runs until whoever finishes the request's work takes it over.
   *
   * Keyed by the request object rather than threaded through as an argument: multer sits
   * between the middleware and the handler and only ever passes `(req, res)` on. Built
   * here rather than at module level because this directory forbids top-level
   * initializers (tools/lint/route-top-level-guard.cjs) — one router, one map.
   */
  const pendingImportJobs = new WeakMap<Request, ImportJobLease>();

  /**
   * Hands the claim `requireImportJob` took over to the caller, who becomes responsible
   * for releasing it. Returns null once it has been taken — by design, so that the two
   * places that can take it (the handler at its start, the response's `close` as a
   * fallback) can both ask without either having to know whether the other got there
   * first.
   */
  const takeImportJob = (req: Request): ImportJobLease | null => {
    const lease = pendingImportJobs.get(req);
    pendingImportJobs.delete(req);
    return lease ?? null;
  };

  const {
    g2gTransferPusherService,
    g2gTransferReceiverService,
    growiBridgeService,
  } = crowi;

  const importService = getImportService();

  if (
    g2gTransferPusherService == null ||
    g2gTransferReceiverService == null ||
    exportService == null ||
    importService == null ||
    growiBridgeService == null ||
    configManager == null
  ) {
    throw Error('GROWI is not ready for g2g transfer');
  }

  const uploads = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, importService.baseDir);
      },
      filename(req, file, cb) {
        // A name of our own rather than the uploaded one, which is the same for every
        // transfer a given source sends: the pusher builds it from the site title and a
        // timestamp that is never evaluated, so two sources called "GROWI" write to the
        // same path. Keeping the .zip suffix leaves `deleteAllZipFiles` able to clean up.
        cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (path.extname(file.originalname) === '.zip') {
        return cb(null, true);
      }
      cb(new Error('Only ".zip" is allowed'));
    },
  });

  /**
   * Claims the right to import before multer starts writing the archive into the shared
   * import directory — not inside the handler, which multer never reaches when it rejects
   * the upload.
   *
   * The claim is only *held* here; it is released by whoever ends up owning the work. See
   * the `close` listener below and the handler's own `finally`.
   */
  const requireImportJob = (
    req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    const lease = importService.acquireImportJob();

    if (lease == null) {
      const refuse = () =>
        res.apiv3Err(
          new ErrorV3(
            'Another import is already running on this GROWI.',
            G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
          ),
          409,
        );

      if (req.readableEnded) {
        return refuse();
      }

      // Read the archive to the end and throw it away before answering. It is never
      // written anywhere — multer is not reached, so the import directory this refusal
      // protects stays untouched — but it has to be read, because an answer sent while the
      // upload is still arriving does not reach the source at all: the connection breaks
      // under the unread body and the pusher gets a send error (`write EPIPE`) in place of
      // this response. The operator would then be told the transfer failed for no stated
      // reason instead of that the destination is already importing. Draining costs the
      // source the upload it had already committed to; answering early costs it the reason.
      req.resume();
      req.once('end', refuse);
      return;
    }

    pendingImportJobs.set(req, lease);

    // A fallback for the requests the handler never gets to run for: multer aborts the
    // request outright for a non-zip upload, a broken multipart body or a client that
    // disconnects mid-upload, and a claim nobody releases would refuse every later import
    // for the lifetime of the process.
    //
    // It must not release a claim the handler has taken over, which is why it goes through
    // `takeImportJob` rather than calling `lease.release` directly: express does not stop
    // the handler when the client disconnects, so `close` fires while `importCollections`
    // is still writing. Releasing there would hand the job to the operator's retry — or to
    // an admin zip import, whose `deleteMany({})` would then run underneath the first
    // import's writes, which is the very thing this claim exists to prevent.
    res.on('close', () => {
      takeImportJob(req)?.release();
    });

    next();
  };

  const uploadsForAttachment = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, importService.baseDir);
      },
      filename(req, file, cb) {
        // to prevent hashing the file name. files with same name will be overwritten.
        cb(null, file.originalname);
      },
    }),
  });

  const adminRequired = adminRequiredFactory(crowi);
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  // Read the install state live (per request), never a value captured here at
  // server boot — see ./g2g-transfer-admin-required-if-installed for why.
  const isInstalled = () => configManager.getConfig('app:installed') === true;

  const adminRequiredIfInstalled = generateAdminRequiredIfInstalled(
    isInstalled,
    adminRequired,
  );

  // Middleware
  const appSiteUrlRequiredIfNotInstalled = (
    req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    if (!isInstalled() && req.body.appSiteUrl != null) {
      next();
      return;
    }

    if (
      configManager.getConfig('app:siteUrl') != null ||
      req.body.appSiteUrl != null
    ) {
      next();
      return;
    }

    return res.apiv3Err(
      new ErrorV3(
        'Body param "appSiteUrl" is required when GROWI is NOT installed yet',
      ),
      400,
    );
  };

  // Local middleware to check if key is valid or not
  const validateTransferKey = async (
    req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    const transferKey = req.headers[X_GROWI_TRANSFER_KEY_HEADER_NAME] as string;

    try {
      await g2gTransferReceiverService.validateTransferKey(transferKey);
    } catch (err) {
      return res.apiv3Err(
        new ErrorV3(
          'Invalid transfer key',
          G2G_INVALID_TRANSFER_KEY_ERROR_CODE,
        ),
        403,
      );
    }

    // Hold the key open for the whole request, starting here rather than around the
    // import: receiving the archive over the network, unzipping it, checking the version
    // and detecting conflicts all happen first and handle the same volume of data, so the
    // key can run out before the import even begins. Starting here also spares
    // `importCollections` any knowledge of transfer keys.
    //
    // `close` rather than `finish`: it fires for a client that disconnects mid-upload too,
    // and an extension nobody stops would keep the key alive forever.
    const stopTransferKeyKeepAlive =
      g2gTransferReceiverService.startTransferKeyKeepAlive(transferKey);
    res.on('close', stopTransferKeyKeepAlive);

    next();
  };

  const router = express.Router();
  const receiveRouter = express.Router();
  const pushRouter = express.Router();

  /**
   * @swagger
   *
   *  /g2g-transfer/files:
   *    get:
   *      summary: /g2g-transfer/files
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      responses:
   *        '200':
   *          description: Successfully got the list of files
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  files:
   *                    type: array
   *                    items:
   *                      type: object
   *                      properties:
   *                        name:
   *                          type: string
   *                          description: The name of the file
   *                        size:
   *                          type: number
   *                          description: The size of the file
   */
  receiveRouter.get(
    '/files',
    validateTransferKey,
    async (req: Request, res: ApiV3Response) => {
      const files = await crowi.fileUploadService.listFiles();
      return res.apiv3({ files });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/keep-alive:
   *    post:
   *      summary: /g2g-transfer/keep-alive
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      responses:
   *        '204':
   *          description: The transfer key's lifetime was extended
   */
  // Answering costs a single key update and nothing else. The source calls this while it
  // builds the archive, and `growi-info` — the only other endpoint it could have used —
  // writes a probe file to the attachment storage that nothing deletes.
  receiveRouter.post(
    '/keep-alive',
    validateTransferKey,
    (req: Request, res: ApiV3Response) => {
      // validateTransferKey has already pushed the key's expiry forward; there is nothing
      // left to do but say so.
      return res.sendStatus(204);
    },
  );

  /**
   * Receives one transfer: unzip the uploaded archive, check it against this GROWI, refuse
   * it if it would collide with the destination's data, then import it.
   *
   * Kept apart from the route handler below so that the two things the handler owns for
   * the whole request — the import claim and the uploaded archive — are released in one
   * `finally` there, rather than at each of the many exits scattered through here.
   */
  const receiveTransferData = async (
    req: Request & { file: any },
    res: ApiV3Response,
  ): Promise<void> => {
    const { file } = req;
    const {
      collections: strCollections,
      optionsMap: strOptionsMap,
      operatorUserId,
      uploadConfigs: strUploadConfigs,
    } = req.body;

    /*
     * parse multipart form data
     */
    let collections: string[];
    let optionsMap: { [key: string]: GrowiArchiveImportOption };
    let sourceGROWIUploadConfigs: any;
    try {
      collections = JSON.parse(strCollections);
      optionsMap = JSON.parse(strOptionsMap);
      sourceGROWIUploadConfigs = JSON.parse(strUploadConfigs);
    } catch (err) {
      logger.error(err);
      return res.apiv3Err(
        new ErrorV3(
          'Failed to parse request body.',
          G2G_PARSE_FAILED_ERROR_CODE,
        ),
        500,
      );
    }

    /*
     * refuse a request that names a collection the transfer must not carry
     *
     * The push route drops those collections before the archive is even built, so this
     * is unreachable through the normal path. It stays as the safety net that makes
     * that guarantee structural rather than a convention, and it runs before anything
     * is unzipped so a refused request leaves the destination untouched.
     */
    const protectedCollections = collections.filter((collectionName) =>
      NON_TRANSFERABLE_COLLECTIONS.has(collectionName),
    );
    if (protectedCollections.length > 0) {
      logger.warn(
        { protectedCollections },
        'Refused the transfer import: the request names collections that must not be transferred',
      );
      return res.apiv3Err(
        new ErrorV3(
          `These collections must not be transferred: ${protectedCollections.join(', ')}`,
          G2G_PROTECTED_COLLECTION_ERROR_CODE,
        ),
        400,
      );
    }

    /*
     * refuse a request whose import-method assignment mixes replacing some
     * collections with appending to others
     *
     * `isCoherentOptionsMap` (models/admin/g2g-transfer-preset.ts) is the single judge
     * of coherence; this route only acts on its answer and never branches on which
     * collection or mode is involved (requirement 1.3). Today's legacy G2G screen can
     * still build a mixed request this way (task 10.1 narrows its choices so it no
     * longer can); this guard is the backstop for anything that reaches this route
     * without going through that screen at all — an automation script or a modified
     * client posting to this endpoint directly. Checked before anything is unzipped
     * or written, so a refused request leaves the destination untouched.
     */
    if (!isCoherentOptionsMap(optionsMap, collections)) {
      logger.warn(
        { collections },
        'Refused the transfer import: the import-method assignment mixes replacing and appending',
      );
      return res.apiv3Err(
        new ErrorV3(
          'The import-method assignment must either replace every collection or replace none of them.',
          G2G_MIXED_IMPORT_MODES_ERROR_CODE,
        ),
        400,
      );
    }

    /*
     * unzip and parse
     */
    let meta: object | undefined;
    let innerFileStats: {
      fileName: string;
      collectionName: string;
      size: number;
    }[];
    try {
      const zipFile = importService.getFile(file.filename);
      await importService.unzip(zipFile);

      const zipFileStat = await growiBridgeService.parseZipFile(zipFile);
      innerFileStats = zipFileStat?.innerFileStats ?? [];
      meta = zipFileStat?.meta;
    } catch (err) {
      logger.error(err);
      return res.apiv3Err(
        new ErrorV3(
          'Failed to validate transfer data file.',
          G2G_VALIDATION_FAILED_ERROR_CODE,
        ),
        500,
      );
    }

    /*
     * validate meta.json
     */
    try {
      importService.validate(meta);
    } catch (err) {
      logger.error(err);
      return res.apiv3Err(
        new ErrorV3(
          'The version of this GROWI and the uploaded GROWI data are not the same',
          G2G_VERSION_INCOMPATIBLE_ERROR_CODE,
        ),
        500,
      );
    }

    /*
     * generate maps of ImportSettings to import
     */
    let importSettingsMap: Map<string, ImportSettings>;
    try {
      importSettingsMap = g2gTransferReceiverService.getImportSettingMap(
        innerFileStats,
        optionsMap,
        operatorUserId,
      );
    } catch (err) {
      logger.error(err);
      return res.apiv3Err(
        new ErrorV3(
          'Import settings are invalid. See GROWI docs about details.',
          G2G_IMPORT_SETTINGS_INVALID_ERROR_CODE,
        ),
      );
    }

    /*
     * detect unique constraint conflicts with the existing data
     *
     * The archive is unzipped but nothing has been written yet, so this is the last
     * point at which the transfer can be refused without leaving the destination in a
     * half-imported state.
     */
    // A collection this import empties first cannot collide with anything: its existing
    // documents are gone before the archive's are written. Detecting a "conflict" there
    // would abort a transfer that was always going to succeed.
    const replaceTargetCollections = deriveReplaceTargets(importSettingsMap);

    let conflictReport: UniqueConflictReport;
    try {
      conflictReport = await g2gTransferReceiverService.detectImportConflicts(
        innerFileStats,
        replaceTargetCollections,
      );
    } catch (err) {
      logger.error(err);
      // A detection that could not complete says nothing about whether the archive
      // collides, and importing on that basis is exactly what drops documents
      // silently and breaks group-granted pages (issue #10151). Fail instead.
      return res.apiv3Err(
        new ErrorV3(
          'Failed to detect data conflicts before import.',
          G2G_CONFLICT_DETECTION_FAILED_ERROR_CODE,
        ),
        500,
      );
    }

    if (hasConflicts(conflictReport)) {
      // Counts only: the conflicting values are user data and must not reach the log.
      logger.warn(
        {
          // The code the response carries, so a log search by the code an operator
          // was shown actually finds this line.
          code: G2G_DATA_CONFLICT_ERROR_CODE,
          errorCode: G2GTransferErrorCode.DATA_CONFLICT,
          userConflictCount: conflictReport.userConflicts.length,
          groupConflictCount: conflictReport.groupConflicts.length,
        },
        'Aborted the transfer import before writing anything: the transfer data conflicts with existing data',
      );
      return res.apiv3Err(
        new ErrorV3(
          summarizeUniqueConflicts(conflictReport),
          G2G_DATA_CONFLICT_ERROR_CODE,
        ),
        409,
      );
    }

    let importResult: ImportCollectionsResult;
    try {
      importResult = await g2gTransferReceiverService.importCollections(
        collections,
        importSettingsMap,
        sourceGROWIUploadConfigs,
      );
    } catch (err) {
      logger.error(err);
      return res.apiv3Err(
        new ErrorV3(
          'Failed to import MongoDB collections',
          G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE,
        ),
        500,
      );
    }

    // The response body is the only way anything that happened over here reaches the
    // operator: the progress notifications they watch are emitted by the source's process,
    // which cannot see into this one. `rescue` carries only what the operator is to be
    // told (see `RescuedAdminSummary`) — never the re-insertion payload, which holds the
    // destination administrators' password hashes and access-token hashes.
    //
    // Answered as a success even when the import aborted: the source transfers no
    // attachment at all unless it is (requirement 5.2, which outranks 2.8 here), and
    // `importAborted` is what keeps that success from reading as a finished transfer.
    return res.apiv3({
      message: 'Successfully started to receive transfer data.',
      failedCollections: importResult.failedCollections,
      importAborted: importResult.importAborted,
      rescue: importResult.rescue,
      rescueApplied: importResult.rescueApplied,
      postProcessFailures: importResult.postProcessFailures,
      maintenanceModeReleased: importResult.maintenanceModeReleased,
    });
  };

  /**
   * @swagger
   *
   *  /g2g-transfer:
   *    post:
   *      summary: /g2g-transfer
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          multipart/form-data:
   *            schema:
   *              type: object
   *              properties:
   *                file:
   *                  type: string
   *                  format: binary
   *                  description: The zip file of the data to be transferred
   *                collections:
   *                  type: array
   *                  description: The list of MongoDB collections to be transferred
   *                  items:
   *                    type: string
   *                optionsMap:
   *                  type: object
   *                  description: The map of options for each collection
   *                operatorUserId:
   *                  type: string
   *                  description: The ID of the operator user
   *                uploadConfigs:
   *                  type: object
   *                  description: The map of upload configurations
   *      responses:
   *        '200':
   *          description: Successfully started to receive transfer data
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  message:
   *                    type: string
   *                    description: The message of the result
   *                  failedCollections:
   *                    type: array
   *                    description: The collections that could not be imported
   *                    items:
   *                      type: string
   *                  importAborted:
   *                    type: boolean
   *                    description: Whether the import threw instead of finishing, in which case it names no collection
   *                  rescue:
   *                    type: object
   *                    nullable: true
   *                    description: How the destination's administrators were kept, when this transfer replaced them
   *                    properties:
   *                      rescued:
   *                        type: array
   *                        items:
   *                          type: object
   *                          properties:
   *                            originalUsername:
   *                              type: string
   *                            rescuedUsername:
   *                              type: string
   *                            emailRemoved:
   *                              type: boolean
   *                            slackMemberIdRemoved:
   *                              type: boolean
   *                            idReassigned:
   *                              type: boolean
   *                  rescueApplied:
   *                    type: boolean
   *                    description: Whether the rescue was written back
   *                  postProcessFailures:
   *                    type: array
   *                    description: The clean-up steps that failed after the import
   *                    items:
   *                      type: string
   *                  maintenanceModeReleased:
   *                    type: boolean
   *                    description: Whether the destination was taken out of maintenance mode again
   */
  receiveRouter.post(
    '/',
    validateTransferKey,
    requireImportJob,
    uploads.single('transferDataZipFile'),
    async (req: Request & { file: any }, res: ApiV3Response) => {
      // Take the claim over from `requireImportJob` before any work starts: from here on
      // it follows the import rather than the response, and the `close` listener leaves it
      // alone. Express does not stop this handler when the client disconnects, so a claim
      // still tied to the response would be free again while `importCollections` is still
      // writing — and the retry that a dropped transfer invites would walk straight into
      // it.
      const importJob = takeImportJob(req);

      try {
        await receiveTransferData(req, res);
      } finally {
        // Both run whether the transfer succeeded or failed: a failed one leaves just as
        // much on disk, and the retry it invites would pile another copy on top. The
        // archive goes first, so the next import never finds this one's leftovers in the
        // shared directory.
        await deleteReceivedArchive(importService.baseDir, req.file);
        importJob?.release();
      }
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/attachment:
   *    post:
   *      summary: /g2g-transfer/attachment
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          multipart/form-data:
   *            schema:
   *              type: object
   *              properties:
   *                file:
   *                  type: string
   *                  format: binary
   *                  description: The zip file of the data to be transferred
   *                attachmentMetadata:
   *                  type: object
   *                  description: Metadata of the attachment
   *      responses:
   *        '200':
   *          description: Successfully imported attachment file
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  message:
   *                    type: string
   *                    description: The message of the result
   */
  // This endpoint uses multer's MemoryStorage since the received data should be persisted directly on attachment storage.
  receiveRouter.post(
    '/attachment',
    validateTransferKey,
    uploadsForAttachment.single('content'),
    async (req: Request & { file: any }, res: ApiV3Response) => {
      const { file } = req;
      const { attachmentMetadata } = req.body;

      let attachmentMap: { fileName: any; fileSize: any };
      try {
        attachmentMap = JSON.parse(attachmentMetadata);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Failed to parse body.', 'parse_failed'),
          500,
        );
      }

      try {
        // Reject unsafe metadata (incl. path-traversal fileNames) at this trust
        // boundary — fileName is attacker-controlled and later joined into the
        // storage path. See g2g-transfer-attachment-metadata.ts.
        const validationError = validateAttachmentMetadata(attachmentMap);
        if (validationError != null) {
          logger.warn({ attachmentMap }, validationError.message);
          return res.apiv3Err(
            new ErrorV3(validationError.message, validationError.code),
            400,
          );
        }

        const { fileName, fileSize } = attachmentMap;
        const count = await Attachment.countDocuments({ fileName, fileSize });
        if (count === 0) {
          logger.warn(
            { fileName, fileSize },
            'Attachment not found in collection.',
          );
          return res.apiv3Err(
            new ErrorV3(
              'Attachment not found in collection.',
              'attachment_not_found',
            ),
            404,
          );
        }
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to check attachment existence.',
            'attachment_check_failed',
          ),
          500,
        );
      }

      // Validate file path to prevent path traversal attack
      const importService = getImportService();
      if (importService == null) {
        return res.apiv3Err(
          new ErrorV3(
            'Import service is not available.',
            'service_unavailable',
          ),
          500,
        );
      }
      // Normalize the path to prevent path traversal attacks
      const resolvedFilePath = path.resolve(file.path);
      if (!isPathWithinBase(resolvedFilePath, importService.baseDir)) {
        logger.error(
          { filePath: resolvedFilePath, baseDir: importService.baseDir },
          'Path traversal attack detected',
        );
        return res.apiv3Err(
          new ErrorV3('Invalid file path.', 'invalid_path'),
          400,
        );
      }

      const fileStream = createReadStream(resolvedFilePath, {
        flags: 'r',
        mode: 0o666,
        autoClose: true,
      });
      try {
        await g2gTransferReceiverService.receiveAttachment(
          fileStream,
          attachmentMap,
        );
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Failed to upload.', 'upload_failed'),
          500,
        );
      }

      return res.apiv3({ message: 'Successfully imported attached file.' });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/growi-info:
   *    get:
   *      summary: /g2g-transfer/growi-info
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - transferHeaderAuth: []
   *      responses:
   *        '200':
   *          description: Successfully got GROWI information
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  growiInfo:
   *                    $ref: '#/components/schemas/GrowiInfo'
   */
  receiveRouter.get(
    '/growi-info',
    validateTransferKey,
    async (req: Request, res: ApiV3Response) => {
      let growiInfo: IDataGROWIInfo;
      try {
        growiInfo = await g2gTransferReceiverService.answerGROWIInfo();
      } catch (err) {
        logger.error(err);

        if (!isG2GTransferError(err)) {
          return res.apiv3Err(
            new ErrorV3(
              'Failed to prepare GROWI info',
              'failed_to_prepare_growi_info',
            ),
            500,
          );
        }

        return res.apiv3Err(new ErrorV3(err.message, err.code), 500);
      }

      return res.apiv3({ growiInfo });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/generate-key:
   *    post:
   *      summary: /g2g-transfer/generate-key
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                appSiteUrl:
   *                  type: string
   *                  description: The URL of the GROWI
   *      responses:
   *        '200':
   *          description: Successfully generated transfer key
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  transferKey:
   *                    type: string
   *                    description: The transfer key
   */
  receiveRouter.post(
    '/generate-key',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXPORT_DATA], { acceptLegacy: true }),
    adminRequiredIfInstalled,
    appSiteUrlRequiredIfNotInstalled,
    async (req: Request, res: ApiV3Response) => {
      const appSiteUrl =
        req.body.appSiteUrl ?? configManager.getConfig('app:siteUrl');

      let appSiteUrlOrigin: string;
      try {
        appSiteUrlOrigin = new URL(appSiteUrl).origin;
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'appSiteUrl may be wrong',
            'failed_to_generate_key_string',
          ),
        );
      }

      // Save TransferKey document
      let transferKeyString: string;
      try {
        transferKeyString =
          await g2gTransferReceiverService.createTransferKey(appSiteUrlOrigin);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Error occurred while generating transfer key.',
            'failed_to_generate_key',
          ),
        );
      }

      return res.apiv3({ transferKey: transferKeyString });
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/transferable-collections:
   *    get:
   *      summary: /g2g-transfer/transferable-collections
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
   *      responses:
   *        '200':
   *          description: Successfully got the collections a transfer may carry
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  collections:
   *                    type: array
   *                    items:
   *                      type: string
   */
  // Deliberately separate from /mongo/collections, which the backup export screen also
  // reads: that screen offers everything that is safe to put in a backup, and narrowing
  // it there would take choices away from a feature this spec does not touch.
  pushRouter.get(
    '/transferable-collections',
    accessTokenParser([SCOPE.READ.ADMIN.EXPORT_DATA], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    async (req: Request, res: ApiV3Response) => {
      try {
        const collectionsInDb = await mongoose.connection.db
          ?.listCollections()
          .toArray();
        const collections = selectTransferableCollections(
          (collectionsInDb ?? []).map(({ name }) => name),
        );

        return res.apiv3({ collections });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to list the collections available for transfer.',
            'failed_to_list_transferable_collections',
          ),
          500,
        );
      }
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/preflight:
   *    post:
   *      summary: /g2g-transfer/preflight
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                transferKey:
   *                  type: string
   *                  description: The transfer key
   *      responses:
   *        '200':
   *          description: Successfully inspected the destination GROWI. Reading this never changes the destination.
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  destinationCounts:
   *                    type: object
   *                    description: How much of the destination a migration transfer would delete
   *                    properties:
   *                      users:
   *                        type: number
   *                      userGroups:
   *                        type: number
   *                      pages:
   *                        type: number
   *                  blockers:
   *                    type: array
   *                    description: Reasons the transfer must not proceed at all
   *                    items:
   *                      type: object
   *                  warnings:
   *                    type: array
   *                    description: Conditions the operator must acknowledge before proceeding
   *                    items:
   *                      type: object
   */
  // Read-only by design (requirement 3.3): this asks the destination for its
  // `growi-info` answer and judges it, but never calls startTransfer. Admin-only, the
  // same as /transfer and /transferable-collections above — an unauthenticated caller
  // must not learn how much of the destination exists or is about to be deleted.
  //
  // No addActivity: per rules/activity-recording.md's decision criteria, an audit row
  // is for an authenticated write that failed, or an anonymous abuse-sensitive
  // endpoint — this route is neither (no write on this GROWI or the destination, and
  // already behind loginRequiredStrictly + adminRequired). Adding addActivity without
  // a matching activityEvent.emit('update', ...) would not settle a row on success —
  // it would only ever surface the failsafe finalizer's ACTION_UNSETTLED row when a
  // preflight failed, so the audit log would record exactly the calls that did NOT
  // work and stay silent about the ones that did, which misrepresents this endpoint's
  // actual usage rather than describing it.
  pushRouter.post(
    '/preflight',
    accessTokenParser([SCOPE.READ.ADMIN.EXPORT_DATA], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.preflight,
    apiV3FormValidator,
    async (req: Request, res: ApiV3Response) => {
      const { transferKey } = req.body;

      let tk: TransferKey;
      try {
        tk = TransferKey.parse(transferKey);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Transfer key is invalid', 'transfer_key_invalid'),
          400,
        );
      }

      try {
        const { destinationCounts, blockers, warnings } =
          await g2gTransferPusherService.preflight(tk);
        return res.apiv3({ destinationCounts, blockers, warnings });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to check whether the transfer can proceed.',
            'failed_to_preflight_transfer',
          ),
          500,
        );
      }
    },
  );

  /**
   * @swagger
   *
   *  /g2g-transfer/transfer:
   *    post:
   *      summary: /g2g-transfer/transfer
   *      tags: [GROWI to GROWI Transfer]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *        - accessTokenHeaderAuth: []
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                transferKey:
   *                  type: string
   *                  description: The transfer key
   *                collections:
   *                  type: array
   *                  description: The list of MongoDB collections to be transferred
   *                  items:
   *                    type: string
   *                optionsMap:
   *                  type: object
   *                  description: The map of options for each collection
   *      responses:
   *        '200':
   *          description: Successfully requested auto transfer
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  message:
   *                    type: string
   *                    description: The message of the result
   */
  pushRouter.post(
    '/transfer',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXPORT_DATA], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.transfer,
    apiV3FormValidator,
    async (req: AuthorizedRequest, res: ApiV3Response) => {
      const { transferKey } = req.body;

      // Drop the collections a transfer must not carry, rather than refusing the request:
      // requirement 5.8 asks for the rest of the transfer to go ahead. This happens here,
      // on the server, and not only in the admin screen that builds the selection — a
      // caller that posts to this endpoint directly never passes through that screen, and
      // the destination would answer such a request with a 400 that fails the whole
      // transfer instead of dropping one collection.
      const { collections, optionsMap } = excludeNonTransferableCollections(
        req.body,
      );

      // Parse transfer key
      let tk: TransferKey;
      try {
        tk = TransferKey.parse(transferKey);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Transfer key is invalid', 'transfer_key_invalid'),
          400,
        );
      }

      // get growi info
      let destGROWIInfo: IDataGROWIInfo;
      try {
        destGROWIInfo = await g2gTransferPusherService.askGROWIInfo(tk);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(
            'Error occurred while asking GROWI info.',
            'failed_to_ask_growi_info',
          ),
        );
      }

      // Check if can transfer
      const transferability =
        await g2gTransferPusherService.getTransferability(destGROWIInfo);
      if (!transferability.canTransfer) {
        return res.apiv3Err(
          new ErrorV3(transferability.reason, 'growi_incompatible_to_transfer'),
        );
      }

      // Start transfer
      // DO NOT "await". Let it run in the background.
      // Errors should be emitted through websocket.
      g2gTransferPusherService.startTransfer(
        tk,
        req.user,
        collections,
        optionsMap,
        destGROWIInfo,
      );

      return res.apiv3({ message: 'Successfully requested auto transfer.' });
    },
  );

  // Merge receiveRouter and pushRouter
  router.use(receiveRouter, pushRouter);

  return router;
};
