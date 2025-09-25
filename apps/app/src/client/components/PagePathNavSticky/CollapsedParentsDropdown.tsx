import { useMemo, type JSX } from 'react';

import Link from 'next/link';
import {
  DropdownItem, DropdownMenu, DropdownToggle, UncontrolledDropdown,
} from 'reactstrap';

import type LinkedPagePath from '~/models/linked-page-path';

import styles from './CollapsedParentsDropdown.module.scss';

const getAncestorPathAndPathNames = (linkedPagePath: LinkedPagePath) => {
  const pathAndPathName: Array<{ path: string, pathName: string }> = [];
  let currentLinkedPagePath = linkedPagePath;

  while (currentLinkedPagePath.parent != null) {
    pathAndPathName.unshift({ path: currentLinkedPagePath.path, pathName: currentLinkedPagePath.pathName });
    currentLinkedPagePath = currentLinkedPagePath.parent;
  }

  return pathAndPathName;
};

type Props = {
  linkedPagePath: LinkedPagePath,
}

export const CollapsedParentsDropdown = (props: Props): JSX.Element => {
  const { linkedPagePath } = props;

  const ancestorPathAndPathNames = useMemo(() => getAncestorPathAndPathNames(linkedPagePath), [linkedPagePath]);

  return (
    <UncontrolledDropdown className="d-inline-block">
      <DropdownToggle color="transparent">...</DropdownToggle>
      <DropdownMenu className={`dropdown-menu ${styles['collapsed-parents-dropdown-menu']}`} container="body">
        {ancestorPathAndPathNames.map(data => (
          <DropdownItem key={data.path}>
            <Link href={data.path} legacyBehavior>
              <a role="menuitem">{data.pathName}</a>
            </Link>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </UncontrolledDropdown>
  );
};
