import type { ChangeEvent } from 'react';
import { useState, type JSX } from 'react';

import type { UseFormRegister, FieldValues } from 'react-hook-form';

import styles from './MaskedInput.module.scss';

type Props = {
  name?: string
  readOnly: boolean
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  tabIndex?: number | undefined
  register?: UseFormRegister<FieldValues>
  fieldName?: string
};

export default function MaskedInput(props: Props): JSX.Element {
  const [passwordShown, setPasswordShown] = useState(false);
  const togglePassword = () => {
    setPasswordShown(!passwordShown);
  };

  const {
    name, readOnly, value, onChange, tabIndex, register, fieldName,
  } = props;

  // Use register if provided, otherwise use value/onChange
  const inputProps = register && fieldName
    ? register(fieldName)
    : {
      name,
      value,
      onChange,
    };

  return (
    <div className={styles.MaskedInput}>
      <input
        className="form-control"
        type={passwordShown ? 'text' : 'password'}
        readOnly={readOnly}
        tabIndex={tabIndex}
        {...inputProps}
      />
      <span onClick={togglePassword} className={styles.PasswordReveal}>
        {passwordShown ? (
          <span className="material-symbols-outlined">visibility</span>
        ) : (
          <span className="material-symbols-outlined">visibility_off</span>
        )}
      </span>
    </div>
  );
}
