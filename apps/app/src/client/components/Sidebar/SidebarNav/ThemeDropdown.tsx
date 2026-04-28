import type { FC } from 'react';
import { memo, useState } from 'react';
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledDropdown,
} from 'reactstrap';

import styles from './ThemeDropdown.module.scss';

type ThemeMode = 'light' | 'dark' | 'auto';

type ThemeOption = {
  mode: ThemeMode;
  iconName: string;
  label: string;
};

const themeOptions: readonly ThemeOption[] = [
  { mode: 'light', iconName: 'light_mode', label: 'Light' },
  { mode: 'dark', iconName: 'dark_mode', label: 'Dark' },
  { mode: 'auto', iconName: 'contrast', label: 'Auto' },
];

export const ThemeDropdown: FC = memo(() => {
  const [selectedMode, setSelectedMode] = useState<ThemeMode>('auto');

  const currentOption =
    themeOptions.find((option) => option.mode === selectedMode) ??
    themeOptions[0];

  return (
    <UncontrolledDropdown direction="end" className={styles['theme-dropdown']}>
      <DropdownToggle
        className="btn btn-primary d-flex align-items-center justify-content-center"
        data-testid="theme-dropdown-button"
      >
        <span className="material-symbols-outlined">
          {currentOption.iconName}
        </span>
      </DropdownToggle>

      <DropdownMenu
        container="body"
        data-testid="theme-dropdown-menu"
        className={styles['theme-dropdown-menu']}
      >
        {themeOptions.map((option) => {
          const isActive = option.mode === selectedMode;
          return (
            <DropdownItem
              key={option.mode}
              active={isActive}
              onClick={() => setSelectedMode(option.mode)}
              className="my-1"
            >
              <span className="d-flex align-items-center">
                <span className="material-symbols-outlined me-2">
                  {option.iconName}
                </span>
                <span className="flex-grow-1">{option.label}</span>
                {isActive && (
                  <span className="material-symbols-outlined ms-2">check</span>
                )}
              </span>
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </UncontrolledDropdown>
  );
});
