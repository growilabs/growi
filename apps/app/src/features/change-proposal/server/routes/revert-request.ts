import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body } from 'express-validator';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import {
  REVERT_REQUEST_ERROR_CODES,
  REVERT_REQUEST_MESSAGE_MAX_LENGTH,
  type RevertRequestBody,
} from '../../interfaces';
import {
  createRevertRequestService,
  type RevertRequestError,
} from '../services/revert-request-service';
import { proposalNotFound } from './get-proposal';
import type {
  AuthenticatedRequest,
  GetChangeProposalService,
} from './read-access';
import { writeAccessChain } from './write-access';

const logger = loggerFactory('growi:features:change-proposal:revert-request');

type Req = AuthenticatedRequest<
  Record<string, string>,
  RevertRequestBody,
  unknown
>;

const respondWithRefusal = (
  res: ApiV3Response,
  error: RevertRequestError,
): unknown => {
  switch (error.code) {
    case 'not-found':
      return res.apiv3Err(proposalNotFound(), 404);
    case 'own-proposal':
      return res.apiv3Err(
        new ErrorV3(
          'The requester cannot ask themselves to revert',
          REVERT_REQUEST_ERROR_CODES.ownProposal,
        ),
        400,
      );
    case 'requester-unavailable':
      return res.apiv3Err(
        new ErrorV3(
          'The requester is no longer an active user',
          REVERT_REQUEST_ERROR_CODES.requesterUnavailable,
        ),
        400,
      );
    case 'recently-requested':
      return res.apiv3Err(
        new ErrorV3(
          'A revert request was sent recently',
          REVERT_REQUEST_ERROR_CODES.recentlySent,
        ),
        409,
      );
  }
};

/**
 * @swagger
 *
 *    /change-proposals/{id}/revert-request:
 *      post:
 *        tags: [ChangeProposals]
 *        summary: Ask the requester of a change proposal to revert it
 *        description: >
 *          Sends the requester one in-app notification carrying the sender, the optional
 *          message and a link to the proposal. The requester may not ask themselves, and
 *          the same sender may ask about the same proposal once a day. A proposal the
 *          caller cannot open gets the same 404 as a missing or malformed id. Requires
 *          the `write:features:page` scope.
 *        parameters:
 *          - name: id
 *            in: path
 *            required: true
 *            schema:
 *              type: string
 *        requestBody:
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  message:
 *                    type: string
 *                    maxLength: 500
 *        responses:
 *          200:
 *            description: The request was sent
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *          400:
 *            description: >
 *              The message is too long or not a string, or a read-only user (code
 *              validation_failed); the caller is the requester (code own_proposal); the
 *              requester is no longer an active user (code requester_unavailable)
 *          403:
 *            description: Not authenticated, or insufficient scope
 *          404:
 *            description: The proposal does not exist or the caller cannot open it (code notfound)
 *          409:
 *            description: The caller already asked about this proposal recently (code revert_request_recently_sent)
 */
export const revertRequestRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => {
  const revertRequestService = createRevertRequestService({
    emitNotificationUpdated: async (userIds) => {
      await crowi.inAppNotificationService?.emitSocketIo(userIds);
    },
  });

  return [
    ...writeAccessChain(crowi),
    // No id validator: a malformed id must look exactly like a missing one.
    body('message')
      .optional()
      .isString()
      .bail()
      .isLength({ max: REVERT_REQUEST_MESSAGE_MAX_LENGTH })
      .withMessage(
        `message must be a string of at most ${REVERT_REQUEST_MESSAGE_MAX_LENGTH} characters`,
      ),
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(user != null, 'ensured by loginRequired');
      const proposalId = req.params.id;
      const senderId = user._id.toString();
      const activityId: unknown = res.locals.activity?._id;
      try {
        if (typeof activityId !== 'string') {
          throw new Error('The request has no activity id');
        }
        const result = await revertRequestService.sendRevertRequest({
          getService,
          proposalId,
          sender: user,
          message: req.body.message ?? '',
          activityId,
          now: new Date(),
        });
        if (!result.ok) {
          logger.info(
            { proposalId, senderId, code: result.error.code },
            'Refused a revert request',
          );
          return respondWithRefusal(res, result.error);
        }

        // emit before res.apiv3() — see rules/activity-recording.md. No target
        // document: the notification is already in place.
        crowi.events.activity.emit('update', activityId, {
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
          targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
          target: proposalId,
        });
        logger.info({ proposalId, senderId }, 'Sent a revert request');
        return res.apiv3({});
      } catch (err) {
        logger.error(
          { err, proposalId, senderId },
          'Failed to send a revert request',
        );
        return res.apiv3Err(
          new ErrorV3(
            'Failed to send the revert request',
            'revert_request_failed',
          ),
          500,
        );
      }
    },
  ];
};
