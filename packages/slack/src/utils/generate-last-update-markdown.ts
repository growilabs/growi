import { formatDistanceStrict } from 'date-fns/formatDistanceStrict';

export function generateLastUpdateMrkdwn(
  updatedAt: string | Date | number,
  baseDate: Date,
): string {
  if (updatedAt != null) {
    // cast to date
    const date = new Date(updatedAt);
    return formatDistanceStrict(date, baseDate);
  }
  return '';
}
