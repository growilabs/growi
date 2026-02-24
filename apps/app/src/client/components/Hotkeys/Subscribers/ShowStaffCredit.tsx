import type { JSX } from 'react';

import StaffCredit from '../../StaffCredit/StaffCredit';

type Props = {
  onDeleteRender: () => void;
};

const ShowStaffCredit = ({ onDeleteRender }: Props): JSX.Element => {
  return <StaffCredit onClosed={onDeleteRender} />;
};

export { ShowStaffCredit };
