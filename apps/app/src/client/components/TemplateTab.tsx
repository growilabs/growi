import React, { type JSX } from 'react';

type Props = {
  template: any,
  onChangeHandler: any,
}

// const onChangeHandler = () => {

// }

export const TemplateTab = (props: Props): JSX.Element => {
  const { template, onChangeHandler } = props;

  return (
    <div key={template.name} className="form-check">
      <input
        type="radio"
        className="form-check-input"
        id="string"
        value={template.value}
        // checked={this.state.linkerType === template.value}
        onChange={onChangeHandler}
      />
      <label className="form-label form-check-label" htmlFor="string">
        {template.name}
      </label>
    </div>
  );
};
