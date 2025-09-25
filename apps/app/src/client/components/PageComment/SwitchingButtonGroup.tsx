import type { ButtonHTMLAttributes, DetailedHTMLProps, JSX } from 'react';
import { memo } from 'react';

import { useTranslation } from 'next-i18next';

import styles from './SwitchingButtonGroup.module.scss';

const moduleClass = styles['btn-group-switching'] ?? '';


type SwitchingButtonProps = DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
    active?: boolean,
}

const SwitchingButton = memo((props: SwitchingButtonProps) => {
  const {
    active, className, children, onClick, ...rest
  } = props;

  return (
    <button
      type="button"
      className={`btn btn-sm py-1 d-flex align-items-center justify-content-center
        ${className}
        ${active ? 'active' : ''}
      `}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
});


type Props = {
  showPreview: boolean,
  onSelected?: (showPreview: boolean) => void,
};

export const SwitchingButtonGroup = (props: Props): JSX.Element => {

  const { t } = useTranslation();

  const {
    showPreview, onSelected,
  } = props;

  return (
    <div
      className={`btn-group ${moduleClass}`}
      role="group"
    >
      <SwitchingButton
        active={showPreview}
        className="ps-2 pe-3"
        onClick={() => onSelected?.(true)}
      >
        <span className="material-symbols-outlined me-0">play_arrow</span>
        <span className="d-none d-sm-inline">{t('page_comment.preview')}</span>
      </SwitchingButton>
      <SwitchingButton
        active={!showPreview}
        className="px-2"
        onClick={() => onSelected?.(false)}
      >
        <span className="material-symbols-outlined me-1">edit_square</span>
        <span className="d-none d-sm-inline">{t('page_comment.write')}</span>
      </SwitchingButton>
    </div>
  );

};
