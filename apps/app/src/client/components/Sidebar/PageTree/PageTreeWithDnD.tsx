import type { JSX } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { PageTreeContent } from './PageTreeSubstance';

type Props = {
  isWipPageShown: boolean;
};

// Wraps PageTreeContent with the DnD provider.
// This file is loaded via dynamic({ ssr: false }) so that react-dnd and
// react-dnd-html5-backend stay out of SSR bundles (and devDependencies).
export const PageTreeWithDnD = ({ isWipPageShown }: Props): JSX.Element => (
  <DndProvider backend={HTML5Backend}>
    <PageTreeContent isWipPageShown={isWipPageShown} />
  </DndProvider>
);
