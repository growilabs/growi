import React, { type JSX } from 'react';

type Props = {
  optionId: string
  label: string,
  isChecked: boolean,
  onChecked: () => void,
  children: React.ReactNode,
}

const CustomizeFunctionOption = (props: Props): JSX.Element => {

  const {
    optionId, label, isChecked, onChecked, children,
  } = props;

  return (
    <React.Fragment>
      <div className="form-check form-check-success">
        <input
          className="form-check-input"
          type="checkbox"
          id={optionId}
          checked={isChecked}
          onChange={onChecked}
        />
        <label className="form-label form-check-label" htmlFor={optionId}>
          <strong>{label}</strong>
        </label>
      </div>
      {children}
    </React.Fragment>
  );

};

export default CustomizeFunctionOption;
