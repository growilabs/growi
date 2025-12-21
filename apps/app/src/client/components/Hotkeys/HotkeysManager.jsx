import React, { useState } from 'react';

import HotkeysDetector from './HotkeysDetector';
import CreatePage from './Subscribers/CreatePage';
import EditPage from './Subscribers/EditPage';
import FocusToGlobalSearch from './Subscribers/FocusToGlobalSearch';
import ShowShortcutsModal from './Subscribers/ShowShortcutsModal';
import ShowStaffCredit from './Subscribers/ShowStaffCredit';
import SwitchToMirrorMode from './Subscribers/SwitchToMirrorMode';

// define supported components list
const SUPPORTED_COMPONENTS = [
  ShowStaffCredit,
  SwitchToMirrorMode,
  ShowShortcutsModal,
  CreatePage,
  EditPage,
  FocusToGlobalSearch,
];

const KEY_SET = new Set();
const STROKE_SET = new Set();
const STROKE_TO_COMPONENT_MAP = {};

SUPPORTED_COMPONENTS.forEach((comp) => {
  const strokes = comp.getHotkeyStrokes();

  strokes.forEach((stroke) => {
    // register key
    stroke.forEach((key) => KEY_SET.add(key));
    // register stroke
    STROKE_SET.add(stroke);
    // register component
    const componentList = STROKE_TO_COMPONENT_MAP[stroke] || [];
    componentList.push(comp);
    STROKE_TO_COMPONENT_MAP[stroke.toString()] = componentList;
  });
});

const HotkeysManager = (props) => {
  const [view, setView] = useState([]);

  /**
   * delete the instance in state.view
   */
  const deleteRender = (instance) => {
    const index = view.lastIndexOf(instance);

    const newView = view.slice(); // shallow copy
    newView.splice(index, 1);
    setView(newView);
  };

  /**
   * activates when one of the hotkey strokes gets determined from HotkeysDetector
   */
  const onDetected = (strokeDetermined) => {
    const key = (Math.random() * 1000).toString();
    const components = STROKE_TO_COMPONENT_MAP[strokeDetermined.toString()];

    const newViews = components.map((Component) => (
      <Component key={key} onDeleteRender={deleteRender} />
    ));
    setView(view.concat(newViews).flat());
  };

  return (
    <>
      <HotkeysDetector
        onDetected={(stroke) => onDetected(stroke)}
        keySet={KEY_SET}
        strokeSet={STROKE_SET}
      />
      {view}
    </>
  );
};

export default HotkeysManager;
