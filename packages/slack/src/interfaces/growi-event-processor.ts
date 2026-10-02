import type { WebClient } from '@slack/web-api';

export interface GrowiEventProcessor<EVENT> {
  shouldHandleEvent(eventType: string): boolean;

  processEvent(client: WebClient, event: EVENT): Promise<void>;
}
