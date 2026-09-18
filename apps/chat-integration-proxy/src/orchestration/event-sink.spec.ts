import { COMMAND_NAMES, type PlatformName } from '@growi/chat';
import { mock } from 'vitest-mock-extended';

import {
  ADMIN_COMMAND_WORDS,
  type ArgumentCollector,
  LINK_COMMAND_WORD,
} from '../command/index.js';
import type { Invocation, PlatformEvent } from '../types/index.js';
import {
  type CommandFlow,
  createEventSink,
  KNOWN_COMMAND_WORDS,
} from './event-sink.js';

const PLATFORM: PlatformName = 'slack';

const channel = {
  platform: PLATFORM,
  channelId: 'C1',
  channelName: 'general',
  isPrivate: false,
};
const actor = {
  platform: PLATFORM,
  accountId: 'U1',
  displayName: 'Yuki',
};

const mentionEvent = (text: string): PlatformEvent => ({
  kind: 'mention',
  platform: PLATFORM,
  channel,
  actor,
  text,
  interaction: null,
});

const slashEvent = (command: string, text = ''): PlatformEvent => ({
  kind: 'slash-command',
  platform: PLATFORM,
  channel,
  actor,
  command,
  text,
  interaction: null,
});

const modalSubmitEvent: PlatformEvent = {
  kind: 'modal-submit',
  platform: PLATFORM,
  channel,
  actor,
  correlationId: 'corr-1',
  values: { keyword: 'foo' },
};

const actionEvent: PlatformEvent = {
  kind: 'action',
  platform: PLATFORM,
  channel,
  actor,
  correlationId: 'corr-1',
  actionId: 'a1',
  value: 'foo',
  interaction: null,
};

const linkPostedEvent: PlatformEvent = {
  kind: 'link-posted',
  platform: PLATFORM,
  channel,
  actor,
  messageRef: { channel, messageId: 'M1' },
  urls: ['https://growi.example.com/some/page'],
};

const anInvocation: Invocation = {
  platform: PLATFORM,
  channel,
  actor,
  commandName: COMMAND_NAMES.search,
  argsText: 'foo',
  interaction: null,
};

/**
 * `resume` is stubbed per test, so the default here is the one outcome that
 * means "nothing to do" -- a test that cares about another outcome says so.
 */
const setup = () => {
  const flow = mock<CommandFlow>();
  const collector = mock<Pick<ArgumentCollector, 'resume'>>();
  collector.resume.mockResolvedValue({ status: 'not-mine' });
  return { flow, collector, sink: createEventSink({ flow, collector }) };
};

describe('the vocabulary a mention is recognized against', () => {
  it('holds every word a user or an operator can actually type', () => {
    // Derived from the three declared sources rather than listed by hand: a
    // command added to `COMMAND_TRAITS` or `ADMIN_COMMAND_WORDS` must become
    // typeable without editing this file (and without editing `event-sink.ts`).
    expect([...KNOWN_COMMAND_WORDS].sort()).toEqual(
      [
        ...Object.values(COMMAND_NAMES),
        LINK_COMMAND_WORD,
        ...ADMIN_COMMAND_WORDS,
      ].sort(),
    );
  });
});

describe('every PlatformEvent kind reaches its declared destination', () => {
  it('sends a mention naming a command to the command flow', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(mentionEvent(`@growi ${COMMAND_NAMES.search} foo`));

    expect(flow.startCommand).toHaveBeenCalledWith(anInvocation);
    expect(collector.resume).not.toHaveBeenCalled();
    expect(flow.previewLinks).not.toHaveBeenCalled();
  });

  it('sends a slash command straight to the command flow', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(slashEvent(COMMAND_NAMES.search, 'foo'));

    expect(flow.startCommand).toHaveBeenCalledWith(anInvocation);
    expect(collector.resume).not.toHaveBeenCalled();
  });

  it('sends a modal submission to the argument collector', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(modalSubmitEvent);

    expect(collector.resume).toHaveBeenCalledWith(modalSubmitEvent);
    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it('sends a button press or list choice to the argument collector', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(actionEvent);

    expect(collector.resume).toHaveBeenCalledWith(actionEvent);
    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it('sends a posted URL to the preview flow, never through command parsing', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(linkPostedEvent);

    expect(flow.previewLinks).toHaveBeenCalledWith(linkPostedEvent);
    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(collector.resume).not.toHaveBeenCalled();
  });
});

describe("a mention's three-step order", () => {
  it('hands a word that is not a command to the collector, to resume with', async () => {
    const { sink, flow, collector } = setup();
    const event = mentionEvent('@growi こんにちは');

    await sink.handle(event);

    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(collector.resume).toHaveBeenCalledWith(event);
  });

  it('does nothing at all when the collector answers not-mine', async () => {
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({ status: 'not-mine' });

    await sink.handle(mentionEvent('@growi こんにちは'));

    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(flow.runCollected).not.toHaveBeenCalled();
    expect(flow.previewLinks).not.toHaveBeenCalled();
  });

  it('treats a bare mention with nothing after it as an ordinary message', async () => {
    // `normalize` answers an empty `commandName` here rather than throwing
    // (task 4.1), so this lands on step 2 like any other unrecognized word --
    // the empty string must never be looked up as if it were a command.
    const { sink, flow, collector } = setup();
    const event = mentionEvent('@growi');

    await sink.handle(event);

    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(collector.resume).toHaveBeenCalledWith(event);
  });

  it('recognizes an operator command typed as a mention', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(mentionEvent('@growi register'));

    expect(flow.startCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'register', argsText: '' }),
    );
    expect(collector.resume).not.toHaveBeenCalled();
  });

  it('recognizes the account-link command typed as a mention', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(mentionEvent(`@growi ${LINK_COMMAND_WORD}`));

    expect(flow.startCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: LINK_COMMAND_WORD, argsText: '' }),
    );
    expect(collector.resume).not.toHaveBeenCalled();
  });
});

describe('a new command supersedes a half-finished one', () => {
  it('routes a command word to the flow even while a collection is in flight, never to resume', async () => {
    // The discard itself belongs to `ArgumentCollector.start` (task 4.4), and
    // this is what lets it happen: were a recognized command word handed to
    // `resume` first, `resume`'s mention branch would read it as the ANSWER to
    // the outstanding question and the half-finished collection would swallow
    // the new command instead of being discarded by it.
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({
      status: 'collected',
      values: { path: '/x' },
      invocation: anInvocation,
    });

    await sink.handle(mentionEvent(`@growi ${COMMAND_NAMES.createPage} /a b`));

    expect(collector.resume).not.toHaveBeenCalled();
    expect(flow.startCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: COMMAND_NAMES.createPage }),
    );
  });
});

describe('what each resume outcome leads to', () => {
  it('runs the command once the collector reports every value collected', async () => {
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({
      status: 'collected',
      values: { keyword: 'foo' },
      invocation: anInvocation,
    });

    await sink.handle(modalSubmitEvent);

    expect(flow.runCollected).toHaveBeenCalledWith(anInvocation, {
      keyword: 'foo',
    });
  });

  it('runs the command against the GROWI the user picked, values and all', async () => {
    // Requirement 8.2. The values were collected BEFORE the question was
    // asked, so they come back with the answer and nothing is asked twice.
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({
      status: 'growi-chosen',
      invocation: anInvocation,
      values: { path: '/memo', body: 'text' },
      relationId: 'rel-b',
    });

    await sink.handle(actionEvent);

    expect(flow.runChosenGrowi).toHaveBeenCalledWith(
      anInvocation,
      { path: '/memo', body: 'text' },
      'rel-b',
    );
    expect(flow.runCollected).not.toHaveBeenCalled();
  });

  it('tells the user when their half-finished input has expired', async () => {
    // The user is present and reachable here, so the input vanishing is worth
    // saying -- and only the flow can post.
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({ status: 'expired' });

    await sink.handle(modalSubmitEvent);

    expect(flow.reportExpired).toHaveBeenCalledWith(modalSubmitEvent);
    expect(flow.runCollected).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'cancelled',
    'not-mine',
  ] as const)('leaves the flow untouched when the collector answers %s', async (status) => {
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({ status });

    await sink.handle(modalSubmitEvent);

    expect(flow.runCollected).not.toHaveBeenCalled();
    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(flow.previewLinks).not.toHaveBeenCalled();
    expect(flow.runChosenGrowi).not.toHaveBeenCalled();
    expect(flow.reportExpired).not.toHaveBeenCalled();
  });
});
