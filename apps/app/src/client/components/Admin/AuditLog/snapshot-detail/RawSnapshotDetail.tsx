import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import type { ISnapshot } from '~/interfaces/activity';

type RawSnapshotDetailProps = {
  snapshot?: ISnapshot;
};

// Snapshot field values are optional-primitive by type, but at runtime may carry
// nested objects/arrays (e.g. a legacy or future shape). Stringify defensively so
// the raw viewer never throws regardless of what a given action's snapshot holds.
const stringifyValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

/**
 * Generic raw viewer for an activity's snapshot: lists every field as a
 * key-value pair, including passthrough fields like `_id`/`id` (that is the
 * nature of a raw view). Falls back to a placeholder when there is nothing to
 * show, and never throws regardless of the snapshot's shape.
 */
export const RawSnapshotDetail: FC<RawSnapshotDetailProps> = (props) => {
  const { snapshot } = props;
  const { t } = useTranslation();

  const entries = snapshot != null ? Object.entries(snapshot) : [];

  if (entries.length === 0) {
    return <p>{t('admin:audit_log_snapshot.no_detail')}</p>;
  }

  return (
    <dl className="row mb-0">
      {entries.map(([key, value]) => (
        <div className="col-12 d-flex" key={key}>
          <dt className="me-2">{key}</dt>
          <dd>{stringifyValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
};
