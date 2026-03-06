import { Controller, PlatformRouter } from '@tsed/common';
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
