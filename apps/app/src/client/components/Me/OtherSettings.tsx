import type { JSX } from 'react';

import { ColorModeSettings } from './ColorModeSettings.js';
import { UISettings } from './UISettings.js';

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
