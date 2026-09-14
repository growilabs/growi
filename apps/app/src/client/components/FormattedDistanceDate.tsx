import { differenceInSeconds } from 'date-fns/differenceInSeconds';
import { format } from 'date-fns/format';
import { formatDistanceStrict } from 'date-fns/formatDistanceStrict';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import { getLocale } from '~/utils/locale-utils';

const ONE_MONTH_IN_SECONDS = 86400 * 30;

type Props = {
  id: string;
  date: string | Date;
  baseDate?: Date;
  // the number(sec) from 'baseDate' to avoid format
  differenceForAvoidingFormat?: number;
  isShowTooltip?: boolean;
};

export const FormattedDistanceDate = (props: Props): JSX.Element => {
  const {
    id,
    date: dateProp,
    baseDate = new Date(),
    differenceForAvoidingFormat = ONE_MONTH_IN_SECONDS,
    isShowTooltip = true,
  } = props;

  const { i18n } = useTranslation();

  // cast to date if string
  const date = typeof dateProp === 'string' ? new Date(dateProp) : dateProp;

  const dateFormatted = format(date, 'yyyy/MM/dd HH:mm');

  const diff = Math.abs(differenceInSeconds(date, baseDate));
  if (diff > differenceForAvoidingFormat) {
    return <>{dateFormatted}</>;
  }

  const elemId = `grw-fdd-${id}`;

  return (
    <>
      <span id={elemId}>
        {formatDistanceStrict(date, baseDate, {
          locale: getLocale(i18n.language),
        })}
      </span>
      {isShowTooltip && (
        <UncontrolledTooltip placement="bottom" fade={false} target={elemId}>
          {dateFormatted}
        </UncontrolledTooltip>
      )}
    </>
  );
};
