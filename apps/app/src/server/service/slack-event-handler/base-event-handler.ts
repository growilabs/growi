import type { GrowiBotEvent } from '@growi/slack';
import type { WebClient } from '@slack/web-api';

import type { EventActionsPermission } from '../../interfaces/slack-integration/events';

export interface SlackEventHandler<T> {
  shouldHandle(
    eventType: string,
    permission: EventActionsPermission,
    channel?: string,
  ): boolean;

  handleEvent(
    client: WebClient,
    growiBotEvent: GrowiBotEvent<T>,
    data?: any,
  ): Promise<void>;
}
