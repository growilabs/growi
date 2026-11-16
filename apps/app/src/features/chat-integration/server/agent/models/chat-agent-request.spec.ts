import { describe, expect, it } from 'vitest';

import { ChatAgentRequest } from './chat-agent-request';

describe('ChatAgentRequest schema', () => {
  it('uses collection name chat_agent_requests', () => {
    expect(ChatAgentRequest.collection.collectionName).toBe(
      'chat_agent_requests',
    );
  });

  // Indexes come from the migration alone; a schema-declared index would be
  // created by autoIndex at boot and could clash with the migration's names.
  it('declares no index of its own and never auto-creates one', () => {
    expect(ChatAgentRequest.schema.indexes()).toEqual([]);
    expect(ChatAgentRequest.schema.get('autoIndex')).toBe(false);
  });

  const build = (overrides: Record<string, unknown> = {}) =>
    new ChatAgentRequest({
      relationId: 'relation-1',
      requestId: 'request-1',
      userId: '507f1f77bcf86cd799439011',
      text: 'what changed?',
      conversationKey: 'slack:C1:1700000000.000100',
      actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
      channel: {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      auditContext: { requestArrivedAt: new Date() },
      ...overrides,
    });

  it('starts a request as running, stamped with its start time', () => {
    const row = build();
    expect(row.state).toBe('running');
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.validateSync()).toBeUndefined();
  });

  it('refuses a state other than running and done', () => {
    expect(
      build({ state: 'queued' }).validateSync()?.errors.state,
    ).toBeDefined();
  });

  it.each([
    'relationId',
    'requestId',
    'userId',
    'text',
    'conversationKey',
    'actor',
    'channel',
    'auditContext',
  ])('requires %s', (field) => {
    expect(
      build({ [field]: undefined }).validateSync()?.errors[field],
    ).toBeDefined();
  });
});
