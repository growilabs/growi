import { useEditorMode } from '~/states/ui/editor/index.js';

export const useEditorModeClassName = (): string => {
  const { getClassNamesByEditorMode } = useEditorMode();

  return `${getClassNamesByEditorMode().join(' ') ?? ''}`;
};
