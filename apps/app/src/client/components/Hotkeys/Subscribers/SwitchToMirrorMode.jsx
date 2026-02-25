import React, { useEffect } from 'react';
import PropTypes from 'prop-types';

const SwitchToMirrorMode = (props) => {
  // setup effect
  useEffect(() => {
    document.body.classList.add('mirror');

    // remove this
    props.onDeleteRender(this);
  }, [props]);

  return <></>;
};

SwitchToMirrorMode.propTypes = {
  onDeleteRender: PropTypes.func.isRequired,
};

SwitchToMirrorMode.getHotkeyStrokes = () => {
  return [['x', 'x', 'b', 'b', 'a', 'y', 'a', 'y', 'ArrowDown', 'ArrowLeft']];
};

export default SwitchToMirrorMode;
