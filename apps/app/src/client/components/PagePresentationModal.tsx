import React, { useCallback } from 'react';

import type { PresentationProps } from '@growi/presentation/dist/client';
import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useFullScreen } from '@growi/ui/dist/utils';
import dynamic from 'next/dynamic';
import type { Options as ReactMarkdownOptions } from 'react-markdown';
import {
  Modal, ModalBody,
} from 'reactstrap';

import { useCurrentPageData } from '~/states/page';
import { useRendererConfig } from '~/states/server-configurations';
import { usePresentationModalActions, usePresentationModalStatus } from '~/states/ui/modal/page-presentation';
import { useNextThemes } from '~/stores-universal/use-next-themes';
import { usePresentationViewOptions } from '~/stores/renderer';

import { RendererErrorMessage } from './Common/RendererErrorMessage';

import styles from './PagePresentationModal.module.scss';

const moduleClass = styles['grw-presentation-modal'] ?? '';


const Presentation = dynamic<PresentationProps>(() => import('./Presentation/Presentation').then(mod => mod.Presentation), {
  ssr: false,
  loading: () => (
    <LoadingSpinner className="text-muted fs-1" />
  ),
});

/**
 * PagePresentationModalSubstance - Heavy processing component (rendered only when modal is open)
 */
const PagePresentationModalSubstance: React.FC = () => {

  const { close: closePresentationModal } = usePresentationModalActions();

  const { isDarkMode } = useNextThemes();
  const fullscreen = useFullScreen();

  const currentPage = useCurrentPageData();
  const { data: rendererOptions, isLoading } = usePresentationViewOptions();

  const { isEnabledMarp } = useRendererConfig();

  const markdown = currentPage?.revision?.body;

  const isSlide = useSlidesByFrontmatter(markdown, isEnabledMarp);

  const toggleFullscreenHandler = useCallback(() => {
    if (fullscreen.active) {
      fullscreen.exit();
    }
    else {
      fullscreen.enter();
    }
  }, [fullscreen]);

  const closeHandler = useCallback(() => {
    if (fullscreen.active) {
      fullscreen.exit();
    }
    closePresentationModal();
  }, [fullscreen, closePresentationModal]);

  return (
    <>
      <div className="grw-presentation-controls d-flex">
        <button
          className="btn material-symbols-outlined"
          type="button"
          aria-label="fullscreen"
          onClick={toggleFullscreenHandler}
        >
          {fullscreen.active ? 'close_fullscreen' : 'open_in_full'}
        </button>
        <button className="btn-close" type="button" aria-label="Close" onClick={closeHandler}></button>
      </div>
      <ModalBody className="modal-body d-flex justify-content-center align-items-center">
        { !isLoading && rendererOptions == null && <RendererErrorMessage />}
        { rendererOptions != null && isEnabledMarp != null && (
          <Presentation
            options={{
              rendererOptions: rendererOptions as ReactMarkdownOptions,
              revealOptions: {
                embedded: true,
                hash: true,
              },
              isDarkMode,
            }}
            marp={isSlide?.marp}
          >
            {markdown}
          </Presentation>
        ) }
      </ModalBody>
    </>
  );
};

/**
 * PagePresentationModal - Container component (lightweight, always rendered)
 */
const PagePresentationModal = (): React.JSX.Element => {
  const presentationModalData = usePresentationModalStatus();
  const { close: closePresentationModal } = usePresentationModalActions();

  const fullscreen = useFullScreen();

  const closeHandler = useCallback(() => {
    if (fullscreen.active) {
      fullscreen.exit();
    }
    closePresentationModal();
  }, [fullscreen, closePresentationModal]);

  const isOpen = presentationModalData?.isOpened ?? false;

  return (
    <Modal
      isOpen={isOpen}
      toggle={closeHandler}
      data-testid="page-presentation-modal"
      className={moduleClass}
    >
      {isOpen && <PagePresentationModalSubstance />}
    </Modal>
  );
};

export default PagePresentationModal;
