import { useState, type JSX } from 'react';

import styles from './MaskedInput.module.scss';

type Props = {
  name: string
  readOnly: boolean
  value: string
  onChange?: (e: any) => void
  tabIndex?: number | undefined
};

export default function MaskedInput(props: Props): JSX.Element {
  const [passwordShown, setPasswordShown] = useState(false);
  const togglePassword = () => {
    setPasswordShown(!passwordShown);
  };

  const {
    name, readOnly, value, onChange, tabIndex,
  } = props;

  return (
    <div className={styles.MaskedInput}>
      <input
        className="form-control"
        type={passwordShown ? 'text' : 'password'}
        name={name}
        readOnly={readOnly}
        value={value}
        onChange={onChange}
        tabIndex={tabIndex}
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
