import React from 'react';

import SimpleBar from 'simplebar-react';

import { useSetSearchKeyword } from '~/states/search';

type RenderTagLabelsProps = {
  tags: string[],
}

const RenderTagLabels = React.memo((props: RenderTagLabelsProps) => {
  const { tags } = props;

  const setSearchKeyword = useSetSearchKeyword();


  return (
    <SimpleBar className="grw-tag-simple-bar pe-1">
      {tags.map(tag => (
        <a
          key={tag}
          type="button"
          className="grw-tag badge me-1 mb-1 text-truncate mw-100"
          onClick={() => setSearchKeyword(`tag:${tag}`)}
        >
          {tag}
        </a>
      ))}
    </SimpleBar>
  );
});
RenderTagLabels.displayName = 'RenderTagLabels';

export default RenderTagLabels;
