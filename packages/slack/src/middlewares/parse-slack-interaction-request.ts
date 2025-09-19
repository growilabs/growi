import type { NextFunction, Response } from 'express';

import type { RequestFromSlack } from '../interfaces/request-from-slack';
import { InteractionPayloadAccessor } from '../utils/interaction-payload-accessor';

export const parseSlackInteractionRequest = (
  req: RequestFromSlack,
  _res: Response,
  next: NextFunction,
): void => {
  // There is no payload in the request from slack
  if (req.body.payload == null) {
    next();
    return;
  }

  req.interactionPayload = JSON.parse(req.body.payload);
  req.interactionPayloadAccessor = new InteractionPayloadAccessor(
    req.interactionPayload,
  );

  next();
};
