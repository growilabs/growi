import { describe, expect, it } from 'vitest';

import { ChatNotificationDestination } from './chat-notification-destination';

describe('ChatNotificationDestination schema', () => {
  const allFields = [
    'relationId',
    'platform',
    'channelId',
    'channelName',
    'pathPattern',
    'triggerEvents',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatNotificationDestination.schema.path(field)).toBeDefined();
  });

  it('uses collection name chat_notification_destinations', () => {
    const collectionName = (
      ChatNotificationDestination.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_notification_destinations');
  });
});
