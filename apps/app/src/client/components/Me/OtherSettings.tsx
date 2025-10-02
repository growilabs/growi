import type { JSX } from 'react';

import { ColorModeSettings } from './ColorModeSettings';
import { UISettings } from './UISettings';


const OtherSettings = (): JSX.Element => {

  return (
    <>
      <div className="mt-4">
        <ColorModeSettings />
      </div>

      <div className="mt-4">
        <UISettings />
      </div>
    </>
  );
};

export default OtherSettings;
