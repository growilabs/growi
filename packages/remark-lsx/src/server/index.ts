import { SCOPE } from '@growi/core/dist/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { FilterXSS } from 'xss';
import type { LsxApiOptions } from '../interfaces/api';
import { listPages } from './routes/list-pages';

const loginRequiredFallback = (req: Request, res: Response) => {
  return res.status(403).send('login required');
};

const filterXSS = new FilterXSS();

const lsxValidator = [
  query('pagePath').notEmpty().isString(),
  query('offset').optional().isInt().toInt(),
  query('limit').optional().isInt().toInt(),
  query('options')
    .optional()
    .customSanitizer((options) => {
      try {
        const jsonData: LsxApiOptions = JSON.parse(options);

        for (const key in jsonData) {
          jsonData[key] = filterXSS.process(jsonData[key]);
        }

        return jsonData;
      } catch {
        throw new Error('Invalid JSON format in options');
      }
    }),
  query('options.*').optional().isString(),
];

const paramValidator = (req: Request, res: Response, next: NextFunction) => {
  const errObjArray = validationResult(req);

  if (errObjArray.isEmpty()) {
    return next();
  }

  const errs = errObjArray.array().map((err) => {
    return new Error(`Invalid lsx parameter: ${err.param}: ${err.msg}`);
  });

  res.status(400).json({ errors: errs.map((err) => err.message) });
};

// biome-ignore lint/suspicious/noExplicitAny: ignore
const middleware = (crowi: any, app: any): void => {
  const loginRequired = crowi.require('../middlewares/login-required')(
    crowi,
    true,
    loginRequiredFallback,
  );
  const accessTokenParser = crowi.accessTokenParser;

  app.get(
    '/_api/lsx',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    lsxValidator,
    paramValidator,
    listPages,
  );
};

export default middleware;
