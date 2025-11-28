import { useEffect } from 'react';

import PropTypes from 'prop-types';

import { useIsEditable } from '~/states/page';
import { EditorMode, useEditorMode } from '~/states/ui/editor';

const EditPage = (props) => {
  const isEditable = useIsEditable();
  const { setEditorMode } = useEditorMode();

  // setup effect
  useEffect(() => {
    if (!isEditable) {
      return;
    }

    // ignore when dom that has 'modal in' classes exists
    if (document.getElementsByClassName('modal in').length > 0) {
      return;
    }

    setEditorMode(EditorMode.Editor);

    // remove this
    props.onDeleteRender(this);
  }, [isEditable, props, setEditorMode]);

  return null;
};

EditPage.propTypes = {
  onDeleteRender: PropTypes.func.isRequired,
};

EditPage.getHotkeyStrokes = () => {
  return [['e']];
};

export default EditPage;
