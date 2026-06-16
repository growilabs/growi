import React from 'react';
import { pathUtils } from '@growi/core/dist/utils';
import PropTypes from 'prop-types';

import SearchTypeahead from './SearchTypeahead';

const PagePathAutoComplete = (props) => {
  const { addTrailingSlash, initializedPath } = props;

  function getKeywordOnInit(path) {
    if (path == null) {
      return;
    }
    return addTrailingSlash
      ? pathUtils.addTrailingSlash(path)
      : pathUtils.removeTrailingSlash(path);
  }

  return (
    <SearchTypeahead
      {...props}
      inputProps={{ name: 'new_path' }}
      placeholder="Input page path"
      keywordOnInit={getKeywordOnInit(initializedPath)}
      autoFocus={props.autoFocus}
    />
  );
};

PagePathAutoComplete.propTypes = {
  initializedPath: PropTypes.string,
  addTrailingSlash: PropTypes.bool,

  onChange: PropTypes.func,
  onSubmit: PropTypes.func,
  onInputChange: PropTypes.func,
  autoFocus: PropTypes.bool,
};

PagePathAutoComplete.defaultProps = {
  initializedPath: '/',
  autoFocus: false,
};

export default PagePathAutoComplete;
