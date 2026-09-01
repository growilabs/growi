import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import type {
  NotificationRequest,
  NotificationResult,
} from './notification.js';

// This spec has no runtime behavior to assert (task 3.2 declares pure
// types, same treatment as task 3.1's command.spec.ts). Its purpose is to
// catch shape mistakes and to prove -- structurally, at compile time --
// that a notification's per-target outcomes can mix `posted` with other
// statuses (a genuine partial-failure shape, not an all-or-nothing flag).

describe('NotificationRequest', () => {
  it('carries targets specified by channelId, a markdown body, and the restricted-page judgement (Requirement 2.1, 2.2, 2.3, 2.6)', () => {
    const request: NotificationRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.notification,
      requestId: 'req-1',
      targets: [
        { platform: 'slack', channelId: 'C1' },
        { platform: 'slack', channelId: 'C2' },
      ],
      markdown: '**/team/notes** was updated by Alice',
      containsRestrictedPage: false,
    };
    expect(request.targets).toHaveLength(2);
    expect(request.targets[0]).toEqual({ platform: 'slack', channelId: 'C1' });
    expect(request.containsRestrictedPage).toBe(false);
  });

  it('omits page content when the target page is restricted -- GROWI decides, not the proxy (Requirement 2.3)', () => {
    const request: NotificationRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.notification,
      requestId: 'req-2',
      targets: [{ platform: 'slack', channelId: 'C1' }],
      markdown: 'A restricted page was updated',
      containsRestrictedPage: true,
    };
    expect(request.containsRestrictedPage).toBe(true);
    // The type itself only carries the judgement as a boolean; the body
    // being free of page content is an app-layer responsibility this
    // contract cannot enforce structurally, so we only assert the field.
  });
});

describe('NotificationResult', () => {
  it('represents a notification where some targets failed and others succeeded, with distinct reasons (Requirement 2.4)', () => {
    const result: NotificationResult = {
      outcomes: [
        { platform: 'slack', channelId: 'C1', status: 'posted' },
        {
          platform: 'slack',
          channelId: 'C2',
          status: 'bot-not-in-channel',
          remedy: 'Invite the bot to this channel',
        },
        {
          platform: 'slack',
          channelId: 'C3',
          status: 'channel-not-in-installation',
          detail: 'Channel does not belong to this workspace installation',
        },
        { platform: 'slack', channelId: 'C4', status: 'inventory-not-ready' },
        {
          platform: 'slack',
          channelId: 'C5',
          status: 'platform-error',
          detail: 'Slack API 500',
        },
        { platform: 'slack', channelId: 'C6', status: 'timeout' },
      ],
    };

    // Prove the shape is genuinely partial-failure: not every outcome
    // shares the same status, and both a success and multiple distinct
    // failure reasons coexist in the same result.
    const statuses = result.outcomes.map((o) => o.status);
    expect(statuses).toContain('posted');
    expect(new Set(statuses).size).toBeGreaterThan(1);
    expect(result.outcomes).toHaveLength(6);
  });

  it('distinguishes inventory-not-ready from channel-not-in-installation (Requirement 2.4)', () => {
    // These two statuses must remain separate values -- collapsing them
    // would point an operator at the wrong fix: one means "proxy hasn't
    // fetched the channel list yet" (wait/retry), the other means "this
    // channel truly isn't part of the workspace" (reconfigure).
    const notReady: NotificationResult['outcomes'][number] = {
      platform: 'slack',
      channelId: 'C1',
      status: 'inventory-not-ready',
    };
    const notInInstallation: NotificationResult['outcomes'][number] = {
      platform: 'slack',
      channelId: 'C2',
      status: 'channel-not-in-installation',
    };
    expect(notReady.status).not.toBe(notInInstallation.status);
  });

  it('always returns one outcome per target, including retries where earlier targets already posted', () => {
    // A retry must still report a previously-succeeded target as `posted`,
    // not omit it -- omitting it would erase the earlier success when
    // GROWI writes the result back into its outbox row.
    const retryResult: NotificationResult = {
      outcomes: [
        { platform: 'slack', channelId: 'C1', status: 'posted' }, // succeeded on the first try
        { platform: 'slack', channelId: 'C2', status: 'timeout' }, // retried this time
      ],
    };
    expect(retryResult.outcomes.map((o) => o.channelId)).toEqual(['C1', 'C2']);
  });

  it('cannot assign a status outside the declared vocabulary (structural probe)', () => {
    // Type-level probe, not a runtime assertion: assigning a bogus
    // `status` string must fail to typecheck. Verified during RED by
    // temporarily removing the `@ts-expect-error` comment -- tsgo rejects
    // the assignment with TS2322 because 'unknown-reason' is not one of
    // the six declared status values.
    const buildWithUnknownStatus = (): NotificationResult => {
      const bogus: NotificationResult = {
        outcomes: [
          {
            platform: 'slack',
            channelId: 'C1',
            // @ts-expect-error -- 'unknown-reason' is not a declared status
            status: 'unknown-reason',
          },
        ],
      };
      return bogus;
    };
    expect(typeof buildWithUnknownStatus).toBe('function');
  });
});
