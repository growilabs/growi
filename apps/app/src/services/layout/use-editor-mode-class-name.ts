import { useEditorMode } from '~/states/ui/editor';

export const useEditorModeClassName = (): string => {
  const { getClassNamesByEditorMode } = useEditorMode();

  return `${getClassNamesByEditorMode().join(' ') ?? ''}`;
};
