import type { CSSProperties, JSX } from 'react';

import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';

import RevisionRenderer from '~/components/PageView/RevisionRenderer';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useRendererConfig } from '~/states/server-configurations';

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

  const { isEnabledMarp } = useRendererConfig();
  const isSlide = useSlidesByFrontmatter(markdown, isEnabledMarp);

  const fluidLayoutClass = expandContentWidth ? 'fluid-layout' : '';


  return (
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
  );

};

export default Preview;
