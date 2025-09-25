import type { JSX } from 'react';

import { useCommentPreviewOptions } from '~/stores/renderer';

import RevisionRenderer from '../../../components/PageView/RevisionRenderer';


import styles from './CommentPreview.module.scss';


const moduleClass = styles['grw-comment-preview'] ?? '';


type CommentPreviewPorps = {
  markdown: string,
}

export const CommentPreview = (props: CommentPreviewPorps): JSX.Element => {

  const { markdown } = props;

  const { data: rendererOptions } = useCommentPreviewOptions();

  if (rendererOptions == null) {
    return <></>;
  }

  return (
    <div className={moduleClass}>
      <RevisionRenderer
        rendererOptions={rendererOptions}
        markdown={markdown}
        additionalClassName="comment"
      />
    </div>
  );

};
