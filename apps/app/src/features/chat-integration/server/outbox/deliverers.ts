import { createNotificationDeliverer } from '../notification/notification-deliverer';
import type { DelivererTable, OutboxDispatcher } from './outbox-dispatcher';
import { createOutboxDispatcher } from './outbox-dispatcher';

/** The single declaration of how each outbox kind is sent. */
export const OUTBOX_DELIVERERS: DelivererTable = {
  notification: createNotificationDeliverer(),
};

export const outboxDispatcher: OutboxDispatcher = createOutboxDispatcher({
  deliverers: OUTBOX_DELIVERERS,
});
