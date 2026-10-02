import { Controller, PlatformRouter } from '@tsed/common';
import { Request, Response } from 'express';

const isOfficialMode = process.env.OFFICIAL_MODE === 'true';

@Controller('/privacy')
export class PrivacyCtrl {
  constructor(router: PlatformRouter) {
    if (isOfficialMode) {
      router.get('/', this.getPrivacy);
    }
  }

  getPrivacy(req: Request, res: Response): void {
    res.render('privacy.ejs');
  }
}
