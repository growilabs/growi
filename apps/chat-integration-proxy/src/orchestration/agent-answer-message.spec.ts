import type {
  AgentAnswer,
  ConversationFailureReason,
  PlatformName,
} from '@growi/chat';
import { describe, expect, it } from 'vitest';

import { CONTINUE_PLACE } from '../capabilities/index.js';
import type { OutboundMessage } from '../types/index.js';
import {
  type AnswerPlace,
  agentAnswerMessage,
} from './agent-answer-message.js';

const ALL_PLATFORMS: readonly PlatformName[] = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

const textOf = (message: OutboundMessage): string => {
  if (message.kind !== 'markdown') {
    throw new Error(`expected a markdown message, got ${message.kind}`);
  }
  return message.markdown;
};

const render = (
  answer: AgentAnswer,
  place: AnswerPlace,
  platform: PlatformName = 'slack',
): string =>
  textOf(
    agentAnswerMessage(answer, {
      place,
      continuePlace: CONTINUE_PLACE[platform],
    }),
  );

const CONTINUE_NOTICE = 'DM';

const textAnswer = (
  sources: ReadonlyArray<{ title: string; url: string }> = [],
): AgentAnswer => ({ kind: 'text', markdown: 'The answer body.', sources });

describe('agentAnswerMessage: text answers', () => {
  it('keeps the answer body as written', () => {
    expect(render(textAnswer(), 'direct')).toContain('The answer body.');
  });

  it('lists every source as a titled link, in the given order', () => {
    const text = render(
      textAnswer([
        { title: 'First page', url: 'https://wiki.example.com/first' },
        { title: 'Second page', url: 'https://wiki.example.com/second' },
      ]),
      'direct',
    );
    expect(text).toContain('[First page](https://wiki.example.com/first)');
    expect(text).toContain('[Second page](https://wiki.example.com/second)');
    expect(text.indexOf('First page')).toBeLessThan(
      text.indexOf('Second page'),
    );
  });

  it('writes no source section when there are no sources', () => {
    expect(render(textAnswer(), 'direct')).toBe('The answer body.');
  });

  it('keeps a title that would break a markdown link from ending the link early', () => {
    const text = render(
      textAnswer([{ title: 'a [b] c', url: 'https://wiki.example.com/x y)' }]),
      'direct',
    );
    expect(text).toContain('[a \\[b\\] c](https://wiki.example.com/x%20y%29)');
  });

  it('falls back to the URL as the label when the title is blank', () => {
    const text = render(
      textAnswer([{ title: '  ', url: 'https://wiki.example.com/p' }]),
      'direct',
    );
    expect(text).toContain(
      '[https://wiki.example.com/p](https://wiki.example.com/p)',
    );
  });

  describe('the continue-in-DM notice (Requirement 15.9)', () => {
    const cases: ReadonlyArray<{
      platform: PlatformName;
      place: AnswerPlace;
      notice: boolean;
    }> = [
      { platform: 'slack', place: 'channel', notice: true },
      { platform: 'mattermost', place: 'channel', notice: true },
      { platform: 'discord', place: 'channel', notice: false },
      { platform: 'teams', place: 'channel', notice: false },
      { platform: 'slack', place: 'direct', notice: false },
      { platform: 'mattermost', place: 'direct', notice: false },
      { platform: 'discord', place: 'direct', notice: false },
      { platform: 'teams', place: 'direct', notice: false },
    ];

    it.each(cases)('$platform / $place: notice present = $notice', ({
      platform,
      place,
      notice,
    }) => {
      const text = render(textAnswer(), place, platform);
      expect(text.includes(CONTINUE_NOTICE)).toBe(notice);
    });

    it('puts the notice after the sources', () => {
      const text = render(
        textAnswer([{ title: 'P', url: 'https://wiki.example.com/p' }]),
        'channel',
        'slack',
      );
      expect(text.indexOf('https://wiki.example.com/p')).toBeLessThan(
        text.indexOf(CONTINUE_NOTICE),
      );
    });
  });
});

const created = (truncated: boolean): AgentAnswer => ({
  kind: 'page-created',
  pageUrl: 'https://wiki.example.com/user/me/memo/summary',
  range: {
    messageCount: 37,
    firstPostedAt: '2026-11-10T01:05:00.000Z',
    lastPostedAt: '2026-11-12T23:59:30.000Z',
  },
  truncated,
});

describe('agentAnswerMessage: page-created answers (Requirements 5.12, 5.16)', () => {
  it('gives the page link, the message count, and the first and last times', () => {
    const text = render(created(false), 'direct');
    expect(text).toContain('https://wiki.example.com/user/me/memo/summary');
    expect(text).toContain('37 件');
    expect(text).toContain('2026-11-10 01:05');
    expect(text).toContain('2026-11-12 23:59');
  });

  it('says the times are UTC so they are not read as local time', () => {
    expect(render(created(false), 'direct')).toContain('UTC');
  });

  it('says nothing about a limited range when the whole conversation was read', () => {
    expect(render(created(false), 'direct')).not.toContain(
      '全部は読めていません',
    );
  });

  it('says only what could be read was summarized when truncated, without claiming old messages are missing', () => {
    const text = render(created(true), 'direct');
    expect(text).toContain('読めた範囲だけ');
    expect(text).toContain('会話の全部は読めていません');
    expect(text).not.toContain('古い発言');
  });

  it('keeps an unparseable time as written instead of printing "Invalid Date"', () => {
    const text = render(
      {
        kind: 'page-created',
        pageUrl: 'https://wiki.example.com/p',
        range: {
          messageCount: 1,
          firstPostedAt: 'yesterday',
          lastPostedAt: 'today',
        },
        truncated: false,
      },
      'direct',
    );
    expect(text).toContain('yesterday');
    expect(text).not.toContain('Invalid Date');
  });

  it.each(
    ALL_PLATFORMS,
  )('never adds the continue notice (%s, channel)', (platform) => {
    expect(render(created(false), 'channel', platform)).not.toContain(
      CONTINUE_NOTICE,
    );
  });
});

const failed = (
  reason: Extract<AgentAnswer, { kind: 'failed' }>['reason'],
  conversationFailure?: Extract<
    AgentAnswer,
    { kind: 'failed' }
  >['conversationFailure'],
): AgentAnswer =>
  conversationFailure == null
    ? { kind: 'failed', reason }
    : { kind: 'failed', reason, conversationFailure };

describe('agentAnswerMessage: failed answers', () => {
  const reasons = [
    'timeout',
    'agent-error',
    'path-conflict',
    'forbidden',
    'conversation-unavailable',
  ] as const;

  it('words every failure reason differently', () => {
    const texts = reasons.map((reason) => render(failed(reason), 'direct'));
    expect(new Set(texts).size).toBe(reasons.length);
  });

  it.each([
    ['timeout', '時間'],
    ['path-conflict', '既に'],
    ['forbidden', '権限'],
  ] as const)('%s says what happened (%s)', (reason, phrase) => {
    expect(render(failed(reason), 'direct')).toContain(phrase);
  });

  it.each(
    reasons.flatMap((reason) =>
      (['channel', 'direct'] as const).flatMap((place) =>
        ALL_PLATFORMS.map((platform) => ({ reason, place, platform })),
      ),
    ),
  )('$reason / $place / $platform: no continue notice', ({
    reason,
    place,
    platform,
  }) => {
    expect(render(failed(reason), place, platform)).not.toContain(
      CONTINUE_NOTICE,
    );
  });

  describe('conversation-unavailable (Requirements 5.13, 5.14, 5.15, 5.17)', () => {
    const remedy = 'Invite the bot, then try again. (remedy)';

    const withReason = (
      reason: ConversationFailureReason,
      remedyText: string | null,
    ): string =>
      render(
        failed('conversation-unavailable', { reason, remedy: remedyText }),
        'direct',
      );

    it.each([
      ['not-in-channel', '参加'],
      ['not-permitted', '権限'],
      ['unsupported', '読めない'],
      ['rate-limited', '制限'],
      ['empty', '1 件もない'],
      ['unknown-request', '見つかりません'],
    ] as const)('%s states its own reason (%s)', (reason, phrase) => {
      expect(withReason(reason, null)).toContain(phrase);
    });

    it.each([
      'not-in-channel',
      'not-permitted',
      'unsupported',
      'rate-limited',
      'empty',
      'unknown-request',
    ] as const)('%s with a remedy shows the remedy as given', (reason) => {
      expect(withReason(reason, remedy)).toContain(remedy);
    });

    it('says to retry later for a rate limit even without a remedy (5.17)', () => {
      expect(withReason('rate-limited', null)).toContain('時間を置いて');
    });

    it('says no page was made when there were no messages (5.14)', () => {
      expect(withReason('empty', null)).toContain('ページは作っていません');
    });

    it('words each conversation failure reason differently', () => {
      const texts = (
        [
          'not-in-channel',
          'not-permitted',
          'unsupported',
          'rate-limited',
          'empty',
          'unknown-request',
        ] as const
      ).map((reason) => withReason(reason, null));
      expect(new Set(texts).size).toBe(texts.length);
    });

    it('still tells the person something when the failure detail is missing', () => {
      const text = render(failed('conversation-unavailable'), 'direct');
      expect(text).toContain('会話を読めませんでした');
    });
  });
});
