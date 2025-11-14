import React, {
  useCallback, useEffect, useMemo, type JSX,
} from 'react';

import { Lang } from '@growi/core';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { LoadingSpinner } from '@growi/ui/dist/components';
import {
  Modal,
  ModalBody,
} from 'reactstrap';

import { replaceFocusedDrawioWithEditor, getMarkdownDrawioMxfile } from '~/client/components/PageEditor/markdown-drawio-util-for-editor';
import { useRendererConfig } from '~/states/server-configurations';
import { useDrawioModalActions, useDrawioModalStatus } from '~/states/ui/modal/drawio';
import { useDrawioModalForEditorStatus, useDrawioModalForEditorActions } from '~/states/ui/modal/drawio-for-editor';
import { useSWRxPersonalSettings } from '~/stores/personal-settings';
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


const DrawioModalSubstance = (): JSX.Element => {
  const { drawioUri } = useRendererConfig();
  const { data: personalSettingsInfo } = useSWRxPersonalSettings({
    // make immutable
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const drawioModalData = useDrawioModalStatus();
  const { close: closeDrawioModal } = useDrawioModalActions();
  const drawioModalDataInEditor = useDrawioModalForEditorStatus();
  const { close: closeDrawioModalInEditor } = useDrawioModalForEditorActions();
  const editorKey = drawioModalDataInEditor?.editorKey ?? null;
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);
  const editor = codeMirrorEditor?.view;
  const isOpenedInEditor = (drawioModalDataInEditor?.isOpened ?? false) && (editor != null);
  const isOpened = drawioModalData?.isOpened ?? false;

  // Memoize URI with parameters calculation

  const drawioUriWithParams = useMemo(() => {
    if (drawioUri === '') {
      return undefined;
    }

    let url;
    try {
      url = new URL(drawioUri);
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
  }, [drawioUri, personalSettingsInfo?.lang]);

  // Memoize communication helper with inline handlers to avoid dependency issues
  const drawioCommunicationHelper = useMemo(() => {
    if (drawioUri === '') {
      return undefined;
    }

    const saveHandler = editor != null
      ? (drawioMxFile: string) => replaceFocusedDrawioWithEditor(editor, drawioMxFile)
      : drawioModalData?.onSave;

    const closeHandler = isOpened ? closeDrawioModal : closeDrawioModalInEditor;

    return new DrawioCommunicationHelper(
      drawioUri,
      drawioConfig,
      { onClose: closeHandler, onSave: saveHandler },
    );
  }, [drawioUri, editor, drawioModalData?.onSave, isOpened, closeDrawioModal, closeDrawioModalInEditor]);

  const receiveMessageHandler = useCallback((event: MessageEvent) => {
    if (drawioModalData == null || drawioCommunicationHelper == null) {
      return;
    }

    const drawioMxFile = editor != null ? getMarkdownDrawioMxfile(editor) : drawioModalData.drawioMxFile;
    drawioCommunicationHelper.onReceiveMessage(event, drawioMxFile ?? null);
  }, [drawioCommunicationHelper, drawioModalData, editor]);

  // Memoize toggle handler
  const toggleHandler = useCallback(() => {
    if (isOpened) {
      closeDrawioModal();
    }
    else {
      closeDrawioModalInEditor();
    }
  }, [isOpened, closeDrawioModal, closeDrawioModalInEditor]);

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
      toggle={toggleHandler}
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

export const DrawioModal = (): JSX.Element => {
  return <DrawioModalSubstance />;
};
