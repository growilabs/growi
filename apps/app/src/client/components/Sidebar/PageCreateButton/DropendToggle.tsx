import type { JSX } from 'react';

import { DropdownToggle } from 'reactstrap';

import { Hexagon } from './Hexagon';

import styles from './DropendToggle.module.scss';


const moduleClass = styles['btn-toggle'];


export const DropendToggle = (): JSX.Element => {
  return (
    <DropdownToggle
      color="primary"
      className={`position-absolute z-1 ${moduleClass}`}
      aria-expanded={false}
      aria-label="Open create page menu"
      data-testid="grw-page-create-button-dropend-toggle"
    >
      <Hexagon className="pe-none" />
      <div className="hitarea position-absolute" />
      <span className="icon material-symbols-outlined position-absolute">chevron_right</span>
    </DropdownToggle>
  );
};
