import { useEffect } from 'react';

type Props = {
  onDeleteRender: () => void;
};

const SwitchToMirrorMode = ({ onDeleteRender }: Props): null => {
  useEffect(() => {
    document.body.classList.add('mirror');
    onDeleteRender();
  }, [onDeleteRender]);

  return null;
};

export { SwitchToMirrorMode };
