import type { CSSProperties, JSX } from 'react';
import { useState } from 'react';

import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';
import {
  Modal, ModalHeader, ModalBody,
} from 'reactstrap';


import RevisionRenderer from '~/components/PageView/RevisionRenderer';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useIsEnabledMarp } from '~/stores-universal/context';

import { SlideRenderer } from '../Page/SlideRenderer';

import styles from './Preview.module.scss';

const moduleClass = styles['page-editor-preview-body'] ?? '';


type Props = {
  rendererOptions: RendererOptions,
  markdown?: string,
  pagePath?: string | null,
  expandContentWidth?: boolean,
  style?: CSSProperties,
  onScroll?: (scrollTop: number) => void,
}

const Preview = (props: Props): JSX.Element => {

  const {
    rendererOptions,
    markdown, pagePath, style,
    expandContentWidth,
  } = props;

  const { data: isEnabledMarp } = useIsEnabledMarp();
  const isSlide = useSlidesByFrontmatter(markdown, isEnabledMarp);

  const fluidLayoutClass = expandContentWidth ? 'fluid-layout' : '';

  const [isModalOpen, setIsModalOpen] = useState(false);

  const toggleModal = () => setIsModalOpen(!isModalOpen);


  return (
    <div
      data-testid="page-editor-preview-body"
      className={`${moduleClass} ${fluidLayoutClass} ${pagePath === '/Sidebar' ? 'preview-sidebar' : ''}`}
      style={style}
    >
      <div className="position-absolute top-0 end-0 m-3" style={{ zIndex: 10 }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={toggleModal}
        >
          <span className="material-symbols-outlined me-1" style={{ fontSize: '18px' }}>open_in_new</span>
          モーダルを開く
        </button>
      </div>

      { markdown != null
        && (
          isSlide != null
            ? <SlideRenderer marp={isSlide.marp} markdown={markdown} />
            : <RevisionRenderer rendererOptions={rendererOptions} markdown={markdown}></RevisionRenderer>
        )
      }

      <Modal isOpen={isModalOpen} toggle={toggleModal} size="lg" centered>
        <ModalHeader toggle={toggleModal}>
          Editor guide
        </ModalHeader>
        <ModalBody>
          <p>Editor guide contents (WIP)</p>
        </ModalBody>
      </Modal>
    </div>
  );

};

export default Preview;
