import React, { type JSX, useEffect } from 'react';

import {
  initializeGrowiFacade,
  registerGrowiFacade,
} from '../utils/growi-facade-utils';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var pluginActivators: {
    [key: string]: {
      activate: () => void;
      deactivate: () => void;
    };
  };
}

async function activateAll(): Promise<void> {
  initializeGrowiFacade();

  // register renderer options to facade
  const { generateViewOptions, generatePreviewOptions } = await import(
    '~/client/services/renderer/renderer'
  );
  registerGrowiFacade({
    markdownRenderer: {
      optionsGenerators: {
        generateViewOptions,
        generatePreviewOptions,
      },
    },
    react: React,
  });

  if (!('pluginActivators' in window)) {
    return;
  }

  Object.entries(pluginActivators).forEach(([, activator]) => {
    activator.activate();
  });
}

export const GrowiPluginsActivator = (): JSX.Element => {
  useEffect(() => {
    activateAll();
  }, []);

  return <></>;
};
