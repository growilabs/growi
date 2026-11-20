import type { IUserHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument } from '~/server/models/page';
import type { GlobalNotificationService } from '~/server/service/global-notification';

import { firePageGlobalNotification } from './page-notifications';

describe('firePageGlobalNotification', () => {
  const page = mock<PageDocument>({ path: '/page-notifications-spec' });
  const user = mock<IUserHasId>();

  it('sends the global notification for the event, page, user and variables', async () => {
    const globalNotificationService = mock<GlobalNotificationService>();
    globalNotificationService.fire.mockResolvedValue();
    const crowi = mock<Crowi>({ globalNotificationService });

    await firePageGlobalNotification(
      crowi,
      GlobalNotificationSettingEvent.PAGE_MOVE,
      page,
      user,
      { oldPath: '/before' },
    );

    expect(globalNotificationService.fire).toHaveBeenCalledTimes(1);
    expect(globalNotificationService.fire).toHaveBeenCalledWith(
      GlobalNotificationSettingEvent.PAGE_MOVE,
      page,
      user,
      { oldPath: '/before' },
    );
  });

  it('resolves even when sending the global notification fails', async () => {
    const globalNotificationService = mock<GlobalNotificationService>();
    globalNotificationService.fire.mockRejectedValue(new Error('smtp down'));
    const crowi = mock<Crowi>({ globalNotificationService });

    await expect(
      firePageGlobalNotification(
        crowi,
        GlobalNotificationSettingEvent.PAGE_EDIT,
        page,
        user,
      ),
    ).resolves.toBeUndefined();
  });
});
