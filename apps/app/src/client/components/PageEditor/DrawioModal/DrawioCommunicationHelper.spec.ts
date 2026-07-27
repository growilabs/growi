// @vitest-environment happy-dom

import { mock } from 'vitest-mock-extended';

import {
  DrawioCommunicationHelper,
  type DrawioConfig,
} from './DrawioCommunicationHelper';

const drawioUri = 'https://embed.example.test';
const drawioConfig: DrawioConfig = {
  css: '',
  customFonts: [],
  compressXml: true,
};

const buildHelper = () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const helper = new DrawioCommunicationHelper(drawioUri, drawioConfig, {
    onSave,
    onClose,
  });
  return { helper, onSave, onClose };
};

// The save branch reads only origin + data; source is unused there.
const saveMessage = (data: string) =>
  mock<MessageEvent>({ origin: drawioUri, data });

describe('DrawioCommunicationHelper.onReceiveMessage — save branch', () => {
  it('saves the (single-page) diagram content and closes the modal', () => {
    const { helper, onSave, onClose } = buildHelper();

    helper.onReceiveMessage(
      saveMessage(
        '<mxfile><diagram id="a" name="P1">CONTENT</diagram></mxfile>',
      ),
      null,
    );

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
