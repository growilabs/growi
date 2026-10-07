import { type JSX, useEffect, useState } from 'react';
import { DropdownToggle } from 'reactstrap';

import { Hexagon } from './Hexagon';

import styles from './DropendToggle.module.scss';

const moduleClass = styles['btn-toggle'];
const activeClass = styles['is-active'];
const hasVisibleClass = styles['has-visible'];
const isVisibleClass = styles['is-visible'];

type Props = {
  isOpen: boolean;
  isVisible: boolean;
};

export const DropendToggle = ({ isOpen, isVisible }: Props): JSX.Element => {
  const [hasVisible, setHasVisible] = useState(false);

  useEffect(() => {
    if (isVisible) setHasVisible(true);
  }, [isVisible]);

  return (
    <DropdownToggle
      color="primary"
      className={`position-absolute z-1 ${moduleClass}${isOpen ? ` ${activeClass}` : ''}${hasVisible ? ` ${hasVisibleClass}` : ''}${isVisible ? ` ${isVisibleClass}` : ''}`}
      aria-expanded={isOpen}
      aria-label="Open create page menu"
      aria-hidden={!isVisible}
      tabIndex={isVisible ? undefined : -1}
      data-testid="grw-page-create-button-dropend-toggle"
    >
      <Hexagon className="pe-none" />
      <div className="hitarea position-absolute" />
      <span className="icon material-symbols-outlined position-absolute">
        chevron_right
      </span>
    </DropdownToggle>
  );
};
