import type { NextServer, RequestHandler } from 'next/dist/server/next';
import type { IncomingMessage } from 'http';

type Crowi = {
  nextApp: NextServer;
};

type CrowiReq = IncomingMessage & {
  crowi: Crowi;
};

type NextDelegatorResult = {
  delegateToNext: RequestHandler;
};

const delegator = (crowi: Crowi): NextDelegatorResult => {
  const { nextApp } = crowi;
  const handle = nextApp.getRequestHandler();

  const delegateToNext: RequestHandler = (
    req: CrowiReq,
    res,
  ): Promise<void> => {
    req.crowi = crowi;
    return handle(req, res);
  };

  return {
    delegateToNext,
  };
};

export default delegator;
