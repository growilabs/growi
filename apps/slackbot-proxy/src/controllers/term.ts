/* eslint-disable @typescript-eslint/consistent-type-imports */
import { Controller, PlatformRouter } from '@tsed/common';
/* eslint-enable @typescript-eslint/consistent-type-imports */
import type { Request, Response } from 'express';

const isOfficialMode = process.env.OFFICIAL_MODE === 'true';

@Controller('/term')
export class TermCtrl {
  constructor(router: PlatformRouter) {
    if (isOfficialMode) {
      router.get('/', this.getTerm);
    }
  }

  getTerm(req: Request, res: Response): void {
    res.render('term.ejs');
  }
}
