import React, {
  useCallback, useEffect, useMemo, type JSX,
} from 'react';

import { Lang } from '@growi/core';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { useDrawioModalForEditor } from '@growi/editor/dist/client/stores/use-drawio';
import { LoadingSpinner } from '@growi/ui/dist/components';
import {
  Modal,
  ModalBody,
} from 'reactstrap';

import { replaceFocusedDrawioWithEditor, getMarkdownDrawioMxfile } from '~/client/components/PageEditor/markdown-drawio-util-for-editor';
import { useRendererConfig } from '~/stores-universal/context';
import { useDrawioModal } from '~/stores/modal';
import { usePersonalSettings } from '~/stores/personal-settings';
import loggerFactory from '~/utils/logger';


import { type DrawioConfig, DrawioCommunicationHelper } from './DrawioCommunicationHelper';

const logger = loggerFactory('growi:components:DrawioModal');


// https://docs.google.com/spreadsheets/d/1FoYdyEraEQuWofzbYCDPKN7EdKgS_2ZrsDrOA8scgwQ
const DIAGRAMS_NET_LANG_MAP = {
  en_US: 'en',
  ja_JP: 'ja',
  zh_CN: 'zh',
  fr_FR: 'fr',
};

export const getDiagramsNetLangCode = (lang: Lang): string => {
  return DIAGRAMS_NET_LANG_MAP[lang];
};


const headerColor = '#334455';
const fontFamily = "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif";

const drawioConfig: DrawioConfig = {
  css: `
  .geMenubarContainer { background-color: ${headerColor} !important; }
  .geMenubar { background-color: ${headerColor} !important; }
  .geEditor { font-family: ${fontFamily} !important; }
  html td.mxPopupMenuItem {
    font-family: ${fontFamily} !important;
    font-size: 8pt !important;
  }
  `,
  customFonts: ['Charter'],
  compressXml: true,
};


export const DrawioModal = (): JSX.Element => {
  const { data: rendererConfig } = useRendererConfig();
  const { data: personalSettingsInfo } = usePersonalSettings({
    // make immutable
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { data: drawioModalData, close: closeDrawioModal } = useDrawioModal();
  const { data: drawioModalDataInEditor, close: closeDrawioModalInEditor } = useDrawioModalForEditor();
  const editorKey = drawioModalDataInEditor?.editorKey ?? null;
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);
  const editor = codeMirrorEditor?.view;
  const isOpenedInEditor = (drawioModalDataInEditor?.isOpened ?? false) && (editor != null);
  const isOpened = drawioModalData?.isOpened ?? false;

  const drawioUriWithParams = useMemo(() => {
    if (rendererConfig == null) {
      return undefined;
    }

    let url;
    try {
      url = new URL(rendererConfig.drawioUri);
    }
    catch (err) {
      logger.debug(err);
      return undefined;
    }

    // refs: https://desk.draw.io/support/solutions/articles/16000042546-what-url-parameters-are-supported-
    url.searchParams.append('spin', '1');
    url.searchParams.append('embed', '1');
    url.searchParams.append('lang', getDiagramsNetLangCode(personalSettingsInfo?.lang ?? Lang.en_US));
    url.searchParams.append('ui', 'atlas');
    url.searchParams.append('configure', '1');

    return url;
  }, [rendererConfig, personalSettingsInfo?.lang]);

  const drawioCommunicationHelper = useMemo(() => {
    if (rendererConfig == null) {
      return undefined;
    }

    const save = editor != null ? (drawioMxFile: string) => {
      replaceFocusedDrawioWithEditor(editor, drawioMxFile);
    } : drawioModalData?.onSave;

    return new DrawioCommunicationHelper(
      rendererConfig.drawioUri,
      drawioConfig,
      { onClose: isOpened ? closeDrawioModal : closeDrawioModalInEditor, onSave: save },
    );
  }, [closeDrawioModal, closeDrawioModalInEditor, drawioModalData?.onSave, editor, isOpened, rendererConfig]);

  const receiveMessageHandler = useCallback((event: MessageEvent) => {
    if (drawioModalData == null) {
      return;
    }

    const drawioMxFile = editor != null ? getMarkdownDrawioMxfile(editor) : drawioModalData.drawioMxFile;
    drawioCommunicationHelper?.onReceiveMessage(event, drawioMxFile);
  }, [drawioCommunicationHelper, drawioModalData, editor]);

  useEffect(() => {
    if (isOpened || isOpenedInEditor) {
      window.addEventListener('message', receiveMessageHandler);
    }
    else {
      window.removeEventListener('message', receiveMessageHandler);
    }

    // clean up
    return function() {
      window.removeEventListener('message', receiveMessageHandler);
    };
  }, [isOpened, isOpenedInEditor, receiveMessageHandler]);

  return (
    <Modal
      isOpen={isOpened || isOpenedInEditor}
      toggle={() => (isOpened ? closeDrawioModal() : closeDrawioModalInEditor())}
      backdrop="static"
      className="drawio-modal grw-body-only-modal-expanded"
      size="xl"
      keyboard={false}
    >
      <ModalBody className="p-0">
        {/* Loading spinner */}
        <div className="w-100 h-100 position-absolute d-flex">
          <div className="mx-auto my-auto">
            <LoadingSpinner className="mx-auto text-muted fs-2" />
          </div>
        </div>
        {/* iframe */}
        { drawioUriWithParams != null && (
          <div className="w-100 h-100 position-absolute d-flex">
            { (isOpened || isOpenedInEditor) && (
              <iframe
                src={drawioUriWithParams.href}
                className="border-0 flex-grow-1"
              >
              </iframe>
            ) }
          </div>
        ) }
      </ModalBody>
    </Modal>
  );
};
