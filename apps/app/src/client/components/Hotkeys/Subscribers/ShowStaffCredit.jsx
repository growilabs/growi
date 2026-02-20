import PropTypes from 'prop-types';

import StaffCredit from '../../StaffCredit/StaffCredit';

const ShowStaffCredit = (props) => {
  return <StaffCredit onClosed={() => props.onDeleteRender(this)} />;
};

ShowStaffCredit.propTypes = {
  onDeleteRender: PropTypes.func.isRequired,
};

export default ShowStaffCredit;
