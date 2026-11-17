import { type AgentAnswer, parseCommandAnswerRequest } from '@growi/chat';

import { textAnswerOf } from './agent-answer';

const SITE_URL = 'https://wiki.example.test';

// A lone surrogate is what a split pair leaves behind; storing it turns it
// into U+FFFD, which chat shows as a broken character.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Fails unless the proxy's parser would accept the answer. */
const sendable = (answer: AgentAnswer): AgentAnswer => {
  const parsed = parseCommandAnswerRequest({
    relationId: 'relation-answer',
    op: 'command-answer',
    requestId: 'req-answer',
    answer,
  });
  expect(parsed).not.toHaveProperty('error');
  return answer;
};

describe('textAnswerOf', () => {
  it('fails with agent-error instead of sending an empty answer', () => {
    const answer = sendable(textAnswerOf({ markdown: '  \n ', sources: [] }));

    expect(answer).toEqual({ kind: 'failed', reason: 'agent-error' });
  });

  // 😀 is two UTF-16 units; one of the two prefixes puts the cut inside a pair.
  it.each([
    [''],
    ['a'],
  ])('cuts an oversized answer to what the proxy accepts and says it was cut (prefix %j)', (prefix) => {
    const long = `${prefix}${'😀'.repeat(20_000)}`;
    const sources = Array.from({ length: 25 }, (_, i) => ({
      title: `Page ${i}`,
      url: `${SITE_URL}/${String(i).padStart(24, '0')}`,
    }));

    const answer = sendable(textAnswerOf({ markdown: long, sources }));

    expect(answer.kind).toBe('text');
    if (answer.kind !== 'text') return;
    expect(answer.markdown.length).toBeLessThanOrEqual(30_000);
    expect(answer.markdown.startsWith(`${prefix}😀😀`)).toBe(true);
    expect(answer.markdown).toMatch(/途中で切りました/);
    expect(answer.markdown).not.toMatch(LONE_SURROGATE);
    expect(answer.sources).toEqual(sources.slice(0, 20));
  });

  it('keeps sources the proxy would refuse out of the answer', () => {
    const answer = sendable(
      textAnswerOf({
        markdown: 'answer',
        sources: [
          { title: 't'.repeat(600), url: `${SITE_URL}/a` },
          { title: 'too long url', url: `${SITE_URL}/${'b'.repeat(2100)}` },
        ],
      }),
    );

    expect(answer).toMatchObject({
      kind: 'text',
      sources: [{ title: 't'.repeat(500), url: `${SITE_URL}/a` }],
    });
  });
});
