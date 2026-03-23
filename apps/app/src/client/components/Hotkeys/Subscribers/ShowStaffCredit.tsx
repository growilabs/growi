import type { JSX } from 'react';

import StaffCredit from '../../StaffCredit/StaffCredit';
import type { HotkeyBindingDef } from '../HotkeysManager';

type Props = {
  onDeleteRender: () => void;
};

export const hotkeyBindings: HotkeyBindingDef = {
  keys: 'ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a',
  category: 'modifier',
};

const ShowStaffCredit = ({ onDeleteRender }: Props): JSX.Element => {
  return <StaffCredit onClosed={onDeleteRender} />;
};

export { ShowStaffCredit };
