import type { JSX } from 'react';

import { useAtomValue } from 'jotai';
import dynamic from 'next/dynamic';

import { aiEnabledAtom } from '~/states/server-configurations';
import { useDrawerOpened } from '~/states/ui/sidebar';

import { EditorAssistantToggleButton } from './EditorAssistantToggleButton';

import styles from './EditorNavbarBottom.module.scss';


const moduleClass = styles['grw-editor-navbar-bottom'];

const SavePageControls = dynamic(() => import('./SavePageControls').then(mod => mod.SavePageControls), { ssr: false });
const OptionsSelector = dynamic(() => import('./OptionsSelector').then(mod => mod.OptionsSelector), { ssr: false });

export const EditorNavbarBottom = (): JSX.Element => {
  const isAiEnabled = useAtomValue(aiEnabledAtom);
  const [, setIsDrawerOpened] = useDrawerOpened();

  return (
    <div className="border-top" data-testid="grw-editor-navbar-bottom">
      <div className={`flex-expand-horiz align-items-center p-2 ps-md-3 pe-md-4 ${moduleClass}`}>
        <a
          role="button"
          className="nav-link btn-lg p-2 d-md-none me-3 opacity-50"
          onClick={() => setIsDrawerOpened(true)}
        >
          <span className="material-symbols-outlined fs-2">reorder</span>
        </a>
        <form className="me-auto d-flex gap-2">
          <OptionsSelector />
          {isAiEnabled && (
            <EditorAssistantToggleButton />
          )}
        </form>
        <form>
          <SavePageControls />
        </form>
      </div>
    </div>
  );
};
