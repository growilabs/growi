import React, { type JSX, useEffect } from 'react';

import {
  useShortcutsModalActions,
  useShortcutsModalStatus,
} from '~/states/ui/modal/shortcuts';

type Props = {
  onDeleteRender: () => void;
};
const ShowShortcutsModal = (props: Props): JSX.Element => {
  const status = useShortcutsModalStatus();
  const { open } = useShortcutsModalActions();

  const { onDeleteRender } = props;

  // setup effect
  useEffect(() => {
    if (status == null) {
      return;
    }

    if (!status.isOpened) {
      open();
      // remove this
      onDeleteRender();
    }
  }, [onDeleteRender, open, status]);

  return <></>;
};

export default ShowShortcutsModal;
