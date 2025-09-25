import React, { type JSX } from 'react';

import type { GrowiThemeMetadata } from '@growi/core';

import styles from './ThemeColorBox.module.scss';

const themeOptionClass = styles['theme-option-container'];


type Props = {
  isSelected: boolean,
  metadata: GrowiThemeMetadata,
  onSelected?: () => void,
};

export const ThemeColorBox = (props: Props): JSX.Element => {

  const {
    isSelected, metadata, onSelected,
  } = props;
  const {
    name, lightBg, darkBg, lightSidebar, darkSidebar, lightIcon, darkIcon, createBtn, isPresetTheme,
  } = metadata;

  return (
    <div
      id={`theme-option-${name}`}
      className={`${themeOptionClass} d-flex flex-column align-items-center ${isSelected ? 'active' : ''}`}
      onClick={onSelected}
    >
      <a
        id={name}
        role="button"
        className={`
          m-0 rounded rounded-3
          border border-4 border-primary ${isSelected ? '' : 'border-opacity-10'}`
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" className="rounded">
          <path d="M32.5,0V36.364L64,20.437V0Z" fill={lightBg} />
          <path d="M32.5,36.364V64H64V20.438Z" fill={darkBg} />
          <path
            d="M4.077,20.648,10.164,10.1H22.338l6.087,10.544L22.338,31.19H10.164ZM0,0V52.8l6.436-3.255v-1.8H10L17.189,44.1H6.436V42.044H21.267L32.5,36.364V0Z"
            fill={lightSidebar}
          />
          <path
            d="M6.436,53.44H26.065V55.5H6.436Zm14.831-11.4h4.8v2.061H17.189L10,47.743H26.065V49.8l-19.629,0v-.259L0,52.8V64H32.5V36.364Z"
            fill={darkSidebar}
          />
          <path d="M22.338,31.19l6.087-10.543L22.338,10.1H10.163L4.077,20.647,10.163,31.19Z" fill={createBtn} />
          <path d="M6.436,49.543,10,47.742H6.436Z" fill={lightIcon} />
          <path d="M6.436,44.106H17.189l4.078-2.062H6.436Z" fill={lightIcon} />
          <path d="M6.436,49.8l19.629,0V47.742H10l-3.561,1.8Z" fill={darkIcon} />
          <path d="M26.065,44.106V42.044h-4.8L17.19,44.106Z" fill={darkIcon} />
          <rect width="19.629" height="2.062" transform="translate(6.436 53.439)" fill={darkIcon} />
        </svg>
      </a>
      <span className={`mt-2 ${isSelected ? '' : 'opacity-25'}`}><b>{ name }</b></span>
      { !isPresetTheme && <span className={`badge bg-primary mt-1 ${isSelected ? '' : 'opacity-25'}`}>Plugin</span> }
    </div>
  );

};
