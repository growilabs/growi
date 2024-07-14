import { useEffect } from 'react';

import PropTypes from 'prop-types';

import { useIsEditable } from '~/stores-universal/context';
import { EditorMode, useEditorMode } from '~/stores-universal/ui';

const EditPage = (props) => {
  const { data: isEditable } = useIsEditable();
  const { mutate: mutateEditorMode } = useEditorMode();

  // setup effect
  useEffect(() => {
    if (!isEditable) {
      return;
    }

    // ignore when dom that has 'modal in' classes exists
    if (document.getElementsByClassName('modal in').length > 0) {
      return;
    }

    mutateEditorMode(EditorMode.Editor);

    // remove this
    props.onDeleteRender(this);
  }, [isEditable, mutateEditorMode, props]);

  return null;
};

EditPage.propTypes = {
  onDeleteRender: PropTypes.func.isRequired,
};

EditPage.getHotkeyStrokes = () => {
  return [['e']];
};

export default EditPage;
