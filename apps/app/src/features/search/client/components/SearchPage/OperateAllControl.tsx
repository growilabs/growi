import type { ChangeEvent, ForwardRefRenderFunction, JSX } from 'react';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Input } from 'reactstrap';

import type { ISelectableAndIndeterminatable } from '~/client/interfaces/selectable-all';
import type { IndeterminateInputElement } from '~/interfaces/indeterminate-input-elm';

type Props = {
  inputId?: string;
  inputClassName?: string;
  isCheckboxDisabled?: boolean;
  onCheckboxChanged?: (isChecked: boolean) => void;
  children?: React.ReactNode;
};

const OperateAllControlSubstance: ForwardRefRenderFunction<
  ISelectableAndIndeterminatable,
  Props
> = (props: Props, ref): JSX.Element => {
  const {
    inputId,
    inputClassName = '',
    isCheckboxDisabled,
    onCheckboxChanged,
    children,
  } = props;

  const selectAllCheckboxElm = useRef<IndeterminateInputElement>(null);

  // publish ISelectable methods
  useImperativeHandle(ref, () => ({
    select: () => {
      const input = selectAllCheckboxElm.current;
      if (input != null) {
        input.checked = true;
        input.indeterminate = false;
      }
    },
    deselect: () => {
      const input = selectAllCheckboxElm.current;
      if (input != null) {
        input.checked = false;
        input.indeterminate = false;
      }
    },
    setIndeterminate: () => {
      const input = selectAllCheckboxElm.current;
      if (input != null) {
        input.indeterminate = true;
      }
    },
  }));

  const checkboxChangedHandler = (e: ChangeEvent<HTMLInputElement>) => {
    if (onCheckboxChanged != null) {
      onCheckboxChanged(e.target.checked);
    }
  };

  return (
    <div className="d-flex align-items-center">
      <Input
        id={inputId}
        type="checkbox"
        data-testid="cb-select-all"
        className={inputClassName}
        innerRef={selectAllCheckboxElm}
        disabled={isCheckboxDisabled}
        onChange={checkboxChangedHandler}
      />
      {children}
    </div>
  );
};

export const OperateAllControl = React.memo(
  forwardRef(OperateAllControlSubstance),
);
