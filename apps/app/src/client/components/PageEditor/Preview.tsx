import type { CSSProperties, JSX } from 'react';
import { useState } from 'react';

import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';


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
      className={`${moduleClass} ${fluidLayoutClass} ${pagePath === '/Sidebar' ? 'preview-sidebar' : ''} position-relative`}
      style={style}
    >
      <div className="position-absolute top-0 end-0 m-3 z-1">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={toggleModal}
        >
          <span className="material-symbols-outlined me-1 align-middle" style={{ fontSize: '18px' }}>open_in_new</span>
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

      {isModalOpen && (
        <>
          <div
            className="position-absolute top-0 start-0 w-100 h-100 bg-dark bg-opacity-50"
            style={{ zIndex: 1040 }}
            onClick={toggleModal}
            role="button"
            tabIndex={0}
            aria-label="Close modal"
            onKeyDown={(e) => { if (e.key === 'Escape') toggleModal(); }}
          />

          <div
            className="position-absolute d-flex justify-content-center align-items-center"
            style={{
              zIndex: 1050,
              top: 200,
              transform: 'translate(100%, 0%)',
            }}
          >
            <div className="card shadow-lg">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Editor guide</h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={toggleModal}
                />
              </div>
              <div className="card-body overflow-auto" style={{ maxHeight: '60vh' }}>
                <p>Editor guide contents (WIP)</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

};

export default Preview;
