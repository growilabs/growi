import React, { type JSX } from 'react';

import { useGrowiVersion } from '~/states/global';
import { useShortcutsModalActions } from '~/states/ui/modal/shortcuts';

import styles from './SystemVersion.module.scss';


type Props = {
  showShortcutsButton?: boolean,
}

const SystemVersion = (props: Props): JSX.Element => {
  const { showShortcutsButton } = props;

  const { open: openShortcutsModal } = useShortcutsModalActions();

  const growiVersion = useGrowiVersion();
  // add classes to cmd-key by OS
  const platform = window.navigator.platform.toLowerCase();
  const isMac = (platform.indexOf('mac') > -1);
  const os = isMac ? 'mac' : 'win';

  return (
    <>
      <div className={`${styles['system-version']} d-none d-md-flex d-edit-none d-print-none align-items-center`}>
        <span>
          <a href="https://growi.org">GROWI</a> {growiVersion}
        </span>
        { showShortcutsButton && (
          <button type="button" className="btn btn-link ms-2 p-0" onClick={() => openShortcutsModal()}>
            <span className="material-symbols-outlined">keyboard</span>&nbsp;<span className={`cmd-key ${os}`}></span>-/
          </button>
        ) }
      </div>

    </>
  );
};

export default SystemVersion;
