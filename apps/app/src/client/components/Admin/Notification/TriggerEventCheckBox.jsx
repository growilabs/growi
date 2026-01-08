import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

const TriggerEventCheckBox = (props) => {
  const { t } = props;

  return (
    <div className={`form-check form-check-${props.checkbox}`}>
      <input
        className="form-check-input"
        type="checkbox"
        id={`trigger-event-${props.event}`}
        checked={props.checked}
        onChange={props.onChange}
      />
      <label
        className="form-label form-check-label"
        htmlFor={`trigger-event-${props.event}`}
      >
        {props.children} {t(`notification_settings.event_${props.event}`)}
      </label>
    </div>
  );
};

TriggerEventCheckBox.propTypes = {
  t: PropTypes.func.isRequired, // i18next

  checkbox: PropTypes.string.isRequired,
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  event: PropTypes.string.isRequired,
  children: PropTypes.object.isRequired,
};

// biome-ignore lint:*:noExplicitModuleBoundaryTypes: Temporary Alternative to @typescript-eslint/explicit-module-boundary-types
const TriggerEventCheckBoxWrapperFC = (props) => {
  const { t } = useTranslation('admin');

  return <TriggerEventCheckBox t={t} {...props} />;
};

export default TriggerEventCheckBoxWrapperFC;
