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
    <>
      {/* wip Trigger */}
      <button
        type="button"
        className="btn btn-light btn-sm position-fixed top-0 end-0 m-3 shadow-sm"
        style={{
          top: '70px',
          zIndex: 10,
        }}
        onClick={toggleModal}
      >
        <span className="material-symbols-outlined align-middle" style={{ fontSize: '18px' }}>
          help
        </span>
        <span className="ms-1">Guide</span>
      </button>

      {isModalOpen && (
        <>
          {/* Editor Guide Modal Overlay */}
          <div
            className="position-fixed top-0 bottom-0 bg-dark opacity-50 start-50 end-0"
            style={{
              zIndex: 1040,
            }}
            onClick={toggleModal}
          />

          {/* Editor Guide Modal */}
          <div
            className="position-fixed top-0 bottom-0 d-flex align-items-center justify-content-center start-50 end-0"
            style={{
              zIndex: 1050,
              pointerEvents: 'none',
            }}
          >
            <div className="w-100 px-3" style={{ maxWidth: '500px', pointerEvents: 'auto' }}>
              <div className="card shadow-lg">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Editor Guide</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={toggleModal}
                    aria-label="Close"
                  />
                </div>
                <div className="card-body overflow-auto">
                  <p>This is a test modal.</p>
                  <p>It appears in the center of the preview area on the right side.</p>
                  <p>The background is darkened to emphasize the modal.</p>
                  <p className="mb-0">Click the close button or the background to close.</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div
        data-testid="page-editor-preview-body"
        className={`${moduleClass} ${fluidLayoutClass} ${pagePath === '/Sidebar' ? 'preview-sidebar' : ''}`}
        style={style}
      >
        { markdown != null
          && (
            isSlide != null
              ? <SlideRenderer marp={isSlide.marp} markdown={markdown} />
              : <RevisionRenderer rendererOptions={rendererOptions} markdown={markdown}></RevisionRenderer>
          )
        }
      </div>
    </>
  );

};

export default Preview;
