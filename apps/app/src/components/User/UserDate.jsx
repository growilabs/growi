import { format } from 'date-fns/format';
import PropTypes from 'prop-types';
import React from 'react';

/**
 * UserDate
 *
 * display date depends on user timezone of user settings
 */
export default class UserDate extends React.Component {
  render() {
    const date = new Date(this.props.dateTime);
    const dt = format(date, this.props.format);

    return (
      <span className={this.props.className} data-vrt-blackout-datetime>
        {dt}
      </span>
    );
  }
}

UserDate.propTypes = {
  dateTime: PropTypes.string.isRequired,
  format: PropTypes.string,
  className: PropTypes.string,
};

UserDate.defaultProps = {
  format: 'yyyy/MM/dd HH:mm:ss',
  className: '',
};
