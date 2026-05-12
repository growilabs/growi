import { differenceInSeconds } from 'date-fns/differenceInSeconds';
import { format } from 'date-fns/format';
import { formatDistanceStrict } from 'date-fns/formatDistanceStrict';
import PropTypes from 'prop-types';
import { UncontrolledTooltip } from 'reactstrap';

const FormattedDistanceDate = (props) => {
  // cast to date if string
  const date =
    typeof props.date === 'string' ? new Date(props.date) : props.date;

  const baseDate = props.baseDate || new Date();

  const dateFormatted = format(date, 'yyyy/MM/dd HH:mm');

  const diff = Math.abs(differenceInSeconds(date, baseDate));
  if (diff > props.differenceForAvoidingFormat) {
    return <>{dateFormatted}</>;
  }

  const elemId = `grw-fdd-${props.id}`;

  return (
    <>
      <span id={elemId}>{formatDistanceStrict(date, baseDate)}</span>
      {props.isShowTooltip && (
        <UncontrolledTooltip placement="bottom" fade={false} target={elemId}>
          {dateFormatted}
        </UncontrolledTooltip>
      )}
    </>
  );
};

FormattedDistanceDate.propTypes = {
  id: PropTypes.string.isRequired,
  date: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)])
    .isRequired,
  baseDate: PropTypes.instanceOf(Date),
  // the number(sec) from 'baseDate' to avoid format
  differenceForAvoidingFormat: PropTypes.number,
  isShowTooltip: PropTypes.bool,
};
FormattedDistanceDate.defaultProps = {
  differenceForAvoidingFormat: 86400 * 3,
  isShowTooltip: true,
};

export default FormattedDistanceDate;
