import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';

describe('PageOperationService at server startup', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let user: { _id: mongoose.Types.ObjectId };
  let page: IPage;

  const createRecord = async (
    actionType: PageActionType,
    actionStage: PageActionStage,
    fromPath: string,
    toPath: string,
  ) =>
    PageOperation.create({
      actionType,
      actionStage,
      fromPath,
      toPath,
      page,
      user: { _id: user._id },
    });

  const remainingActionTypes = async (fromPaths: string[]) => {
    const records = await PageOperation.find({ fromPath: { $in: fromPaths } });
    return records.map((r) => `${r.actionType}/${r.actionStage}`).sort();
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    const User = mongoose.model('User');
    user = await User.create({
      name: 'pageOpStartupUser',
      username: 'pageOpStartupUser',
      email: 'pageOpStartupUser@example.com',
    });
    page = await Page.create({
      path: '/page-op-startup',
      grant: Page.GRANT_PUBLIC,
    });
  });

  afterEach(async () => {
    await PageOperation.deleteMany({ fromPath: /^\/page-op-startup/ });
  });

  it('removes operation records left by an interrupted operation, so the paths can be operated on again', async () => {
    await createRecord(
      PageActionType.Duplicate,
      PageActionStage.Main,
      '/page-op-startup/duplicate',
      '/page-op-startup/duplicate2',
    );
    await createRecord(
      PageActionType.Delete,
      PageActionStage.Main,
      '/page-op-startup/delete',
      '/trash/page-op-startup/delete',
    );
    await createRecord(
      PageActionType.Rename,
      PageActionStage.Main,
      '/page-op-startup/rename-main',
      '/page-op-startup/rename-main2',
    );
    expect(
      await crowi.pageOperationService.canOperate(
        true,
        '/page-op-startup/duplicate',
        '/page-op-startup/duplicate-moved',
      ),
    ).toBe(false);

    await crowi.setupPageService();

    expect(
      await remainingActionTypes([
        '/page-op-startup/duplicate',
        '/page-op-startup/delete',
        '/page-op-startup/rename-main',
      ]),
    ).toEqual([]);
    expect(
      await crowi.pageOperationService.canOperate(
        true,
        '/page-op-startup/duplicate',
        '/page-op-startup/duplicate-moved',
      ),
    ).toBe(true);
  });

  it('keeps the second half of a rename, which is resumed instead of discarded', async () => {
    await createRecord(
      PageActionType.Rename,
      PageActionStage.Sub,
      '/page-op-startup/rename-sub',
      '/page-op-startup/rename-sub2',
    );

    await crowi.setupPageService();

    expect(await remainingActionTypes(['/page-op-startup/rename-sub'])).toEqual(
      [`${PageActionType.Rename}/${PageActionStage.Sub}`],
    );
  });
});
