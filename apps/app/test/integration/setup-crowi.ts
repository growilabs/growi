import { Server } from 'http';

import Crowi from '../../src/server/crowi';
import { setupModelsDependentOnCrowi } from '../../src/server/crowi/setup-models';

let _instance: Crowi;

const initCrowi = async (crowi: Crowi) => {
  crowi.models = await setupModelsDependentOnCrowi(crowi);
  await crowi.setupConfigManager();

  await crowi.setupSocketIoService();
  await crowi.socketIoService.attachServer(new Server()); // attach dummy server

  await Promise.all([crowi.setUpApp()]);

  await Promise.all([
    crowi.setupPassport(),
    crowi.setupAttachmentService(),
    crowi.setUpAcl(),
    crowi.setupPageService(),
    crowi.setupInAppNotificationService(),
    crowi.setupActivityService(),
    crowi.setupUserGroupService(),
  ]);
};

export async function getInstance(isNewInstance?: boolean): Promise<Crowi> {
  if (isNewInstance) {
    const crowi = new Crowi();
    await initCrowi(crowi);
    return crowi;
  }

  // initialize singleton instance
  if (_instance == null) {
    _instance = new Crowi();
    await initCrowi(_instance);
  }
  return _instance;
}
