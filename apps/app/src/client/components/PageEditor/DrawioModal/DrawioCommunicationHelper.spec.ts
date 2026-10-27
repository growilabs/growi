// @vitest-environment happy-dom

import { mock } from 'vitest-mock-extended';

import {
  DrawioCommunicationHelper,
  type DrawioConfig,
} from './DrawioCommunicationHelper';

const drawioUri = 'https://embed.example.test';
const drawioConfig: DrawioConfig = {
  css: '.geMenubarContainer { color: #eeeeee; }',
  customFonts: ['Lato', 'Noto Sans JP'],
  compressXml: true,
};

const buildHelper = (uri: string = drawioUri) => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const helper = new DrawioCommunicationHelper(uri, drawioConfig, {
    onSave,
    onClose,
  });
  return { helper, onSave, onClose };
};

// 'configure' and 'ready' answer back to whoever sent the message, so every event
// carries a sender whose postMessage is observable. The remaining branches never
// touch it, and the save branch reads only origin + data.
const messageFrom = (origin: string, data: unknown) => {
  const postMessage = vi.fn();
  return {
    event: mock<MessageEvent>({ origin, data, source: { postMessage } }),
    postMessage,
  };
};

const saveMessage = (data: string) => messageFrom(drawioUri, data).event;

const SINGLE_PAGE_MXFILE =
  '<mxfile><diagram id="a" name="P1">CONTENT</diagram></mxfile>';

describe('DrawioCommunicationHelper.onReceiveMessage — save branch', () => {
  it('saves the (single-page) diagram content and closes the modal', () => {
    const { helper, onSave, onClose } = buildHelper();

    helper.onReceiveMessage(saveMessage(SINGLE_PAGE_MXFILE), null);

    expect(onSave).toHaveBeenCalledWith('CONTENT');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT overwrite the diagram when no page can be extracted', () => {
    // A 0-diagram / unparseable payload must not silently clobber the existing
    // diagram with an empty block (see #11522 review). onClose still fires.
    const { helper, onSave, onClose } = buildHelper();

    helper.onReceiveMessage(saveMessage('<mxfile></mxfile>'), null);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DrawioCommunicationHelper.onReceiveMessage — origin check', () => {
  it('ignores a message sent from an origin other than the configured draw.io', () => {
    const { helper, onSave, onClose } = buildHelper();
    // The payload is one that WOULD be saved if the origin matched, so this test
    // fails as soon as the origin comparison stops rejecting the message.
    const { event, postMessage } = messageFrom(
      'https://evil.example.test',
      SINGLE_PAGE_MXFILE,
    );

    helper.onReceiveMessage(event, null);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('accepts a message from the configured instance deployed under a sub path', () => {
    // Only the origin is compared, so a sub-path deployment still matches.
    const { helper, onSave, onClose } = buildHelper(
      'https://drawio.example.test/drawio/?embed=1',
    );
    const { event } = messageFrom(
      'https://drawio.example.test',
      SINGLE_PAGE_MXFILE,
    );

    helper.onReceiveMessage(event, null);

    expect(onSave).toHaveBeenCalledWith('CONTENT');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DrawioCommunicationHelper.onReceiveMessage — configure branch', () => {
  it('answers the configure request with the configuration it was given', () => {
    const { helper, onSave, onClose } = buildHelper();
    const { event, postMessage } = messageFrom(
      drawioUri,
      '{"event":"configure"}',
    );

    helper.onReceiveMessage(event, null);

    expect(postMessage).toHaveBeenCalledTimes(1);
    // Assert the parsed payload, not the serialized text, so formatting is free.
    expect(JSON.parse(postMessage.mock.calls[0][0])).toStrictEqual({
      action: 'configure',
      config: drawioConfig,
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('DrawioCommunicationHelper.onReceiveMessage — ready branch (restore path)', () => {
  const storedMultiPageDiagram =
    '<mxfile><diagram id="a" name="P1">ONE</diagram><diagram id="b" name="P2">TWO</diagram></mxfile>';

  it('answers with the stored diagram untouched, so every page is restored', () => {
    const { helper, onSave, onClose } = buildHelper();
    const { event, postMessage } = messageFrom(drawioUri, 'ready');

    helper.onReceiveMessage(event, storedMultiPageDiagram);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toBe(storedMultiPageDiagram);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still answers when nothing is stored yet (a brand-new diagram)', () => {
    const { helper } = buildHelper();
    const { event, postMessage } = messageFrom(drawioUri, 'ready');

    helper.onReceiveMessage(event, null);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toBeNull();
  });
});

describe('DrawioCommunicationHelper.onReceiveMessage — close and fall-through', () => {
  it('closes the modal on an empty message without saving anything', () => {
    const { helper, onSave, onClose } = buildHelper();
    const { event } = messageFrom(drawioUri, '');

    helper.onReceiveMessage(event, null);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does nothing for a message that matches none of the branches', () => {
    const { helper, onSave, onClose } = buildHelper();
    const { event, postMessage } = messageFrom(drawioUri, '{"event":"init"}');

    helper.onReceiveMessage(event, null);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
