import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { GlobalHotKeys } from 'react-hotkeys';

import HotkeyStroke from '~/client/models/HotkeyStroke';

const HotkeysDetector = (props) => {
  const { keySet, strokeSet, onDetected } = props;

  // memorize HotkeyStroke instances
  const hotkeyStrokes = useMemo(() => {
    const strokes = Array.from(strokeSet);
    return strokes.map((stroke) => new HotkeyStroke(stroke));
  }, [strokeSet]);

  /**
   * return key expression string includes modifier
   */
  const getKeyExpression = useCallback((event) => {
    let eventKey = event.key;

    if (event.ctrlKey) {
      eventKey += '+ctrl';
    }
    if (event.metaKey) {
      eventKey += '+meta';
    }
    if (event.altKey) {
      eventKey += '+alt';
    }
    if (event.shiftKey) {
      eventKey += '+shift';
    }

    return eventKey;
  }, []);

  /**
   * evaluate the key user pressed and trigger onDetected
   */
  const checkHandler = useCallback(
    (event) => {
      const eventKey = getKeyExpression(event);

      hotkeyStrokes.forEach((hotkeyStroke) => {
        // if any stroke is completed
        if (hotkeyStroke.evaluate(eventKey)) {
          // cancel the key event
          event.preventDefault();
          // invoke detected handler
          onDetected(hotkeyStroke.stroke);
        }
      });
    },
    [hotkeyStrokes, getKeyExpression, onDetected],
  );

  // memorize keyMap for GlobalHotKeys
  const keyMap = useMemo(() => {
    return { check: Array.from(keySet) };
  }, [keySet]);

  // memorize handlers for GlobalHotKeys
  const handlers = useMemo(() => {
    return { check: checkHandler };
  }, [checkHandler]);

  return <GlobalHotKeys keyMap={keyMap} handlers={handlers} />;
};

HotkeysDetector.propTypes = {
  onDetected: PropTypes.func.isRequired,
  keySet: PropTypes.instanceOf(Set).isRequired,
  strokeSet: PropTypes.instanceOf(Set).isRequired,
};

export default HotkeysDetector;
