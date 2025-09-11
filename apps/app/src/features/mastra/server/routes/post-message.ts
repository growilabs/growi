import type { IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { mastra } from '../services';

const logger = loggerFactory('growi:routes:apiv3:mastra:post-message-handler');

type ReqBody = {
  userMessage: string,
  mode: 'ask' | 'agent'
}

type Req = Request<any, Response, ReqBody> & {
  user: IUserHasId,
}

type PostMessageHandlersFactory = () => RequestHandler[];

export const postMessageHandlersFactory: PostMessageHandlersFactory = () => {
  const validator: ValidationChain[] = [
    body('mode')
      .isIn(['ask', 'agent'])
      .withMessage('mode must be either "ask" or "agent"'),
    body('userMessage')
      .isString()
      .withMessage('userMessage must be string'),
  ];

  return [...validator, apiV3FormValidator, async(req: Req, res: ApiV3Response) => {
    const { mode, userMessage } = req.body;

    const workflow = mode === 'ask'
      ? mastra.getWorkflow('fileSearchWorkflow')
      : mastra.getWorkflow('growiAgentWorkflow');

    const run = workflow.createRun();

    try {
      const stream = run.streamVNext({ inputData: { prompt: userMessage } });

      for await (const chunk of stream) {
        const payloadType = chunk?.payload?.output?.type;
        const text = chunk?.payload?.output?.text;

        // eslint-disable-next-line max-len
        if (payloadType === 'pre-message-step-event' || payloadType === 'file-search-step-event' || payloadType === 'growi-agent-step-event') {
          console.log(text);
        }
      }
      return res.apiv3({});
    }

    catch (error) {
      logger.error(error);
      if (!res.headersSent) {
        return res.apiv3Err(new ErrorV3('Failed to post message'));
      }
    }
  },
  ];
};
