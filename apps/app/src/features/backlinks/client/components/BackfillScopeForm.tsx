import type { FormEvent, JSX } from 'react';
import { useId, useState } from 'react';
import { useTranslation } from 'next-i18next';

import {
  BackfillScopeKind,
  type BacklinksBackfillStartRequest,
} from '../../interfaces/page-link-backfill';
import {
  type BackfillScopeForm as ScopeFormValue,
  toBackfillStartRequest,
} from '../utils/backfill-start-request';

type Props = {
  readonly disabled: boolean;
  readonly onStart: (request: BacklinksBackfillStartRequest) => Promise<void>;
};

const INVALID_MESSAGE_KEYS = {
  invalidMaxPages: 'admin:backlinks_backfill.invalid_max_pages',
  invalidSince: 'admin:backlinks_backfill.invalid_since',
} as const;

const SCOPE_LABEL_KEYS: Readonly<Record<BackfillScopeKind, string>> = {
  [BackfillScopeKind.ALL]: 'admin:backlinks_backfill.scope_all',
  [BackfillScopeKind.MAX_PAGES]: 'admin:backlinks_backfill.scope_max_pages',
  [BackfillScopeKind.SINCE]: 'admin:backlinks_backfill.scope_since',
};

/** The scope picker and Start. */
export const BackfillScopeForm = ({
  disabled,
  onStart,
}: Props): JSX.Element => {
  const { t } = useTranslation('admin');
  const id = useId();
  const [form, setForm] = useState<ScopeFormValue>({
    kind: BackfillScopeKind.ALL,
    maxPages: '',
    since: '',
  });
  const [invalidKey, setInvalidKey] = useState<string | null>(null);

  const update = (patch: Partial<ScopeFormValue>) => {
    setForm((current) => ({ ...current, ...patch }));
    setInvalidKey(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = toBackfillStartRequest(form, new Date());
    if (!result.ok) {
      setInvalidKey(INVALID_MESSAGE_KEYS[result.reason]);
      return;
    }
    await onStart(result.request);
  };

  const radio = (kind: BackfillScopeKind) => (
    <div className="form-check" key={kind}>
      <input
        className="form-check-input"
        type="radio"
        name={`${id}-scope`}
        id={`${id}-${kind}`}
        checked={form.kind === kind}
        disabled={disabled}
        onChange={() => update({ kind })}
      />
      <label className="form-check-label" htmlFor={`${id}-${kind}`}>
        {t(SCOPE_LABEL_KEYS[kind])}
      </label>
    </div>
  );

  return (
    <form className="my-3" onSubmit={onSubmit} noValidate>
      <fieldset disabled={disabled}>
        <legend className="fs-6">{t('admin:backlinks_backfill.scope')}</legend>
        {radio(BackfillScopeKind.ALL)}
        {radio(BackfillScopeKind.MAX_PAGES)}
        <div className="ms-4 mb-2">
          <label className="form-label small" htmlFor={`${id}-maxPages-value`}>
            {t('admin:backlinks_backfill.max_pages_label')}
          </label>
          <input
            className="form-control form-control-sm w-auto"
            type="number"
            min={1}
            step={1}
            id={`${id}-maxPages-value`}
            value={form.maxPages}
            disabled={form.kind !== BackfillScopeKind.MAX_PAGES}
            onChange={(e) => update({ maxPages: e.target.value })}
          />
        </div>
        {radio(BackfillScopeKind.SINCE)}
        <div className="ms-4 mb-2">
          <label className="form-label small" htmlFor={`${id}-since-value`}>
            {t('admin:backlinks_backfill.since_label')}
          </label>
          <input
            className="form-control form-control-sm w-auto"
            type="date"
            id={`${id}-since-value`}
            value={form.since}
            disabled={form.kind !== BackfillScopeKind.SINCE}
            onChange={(e) => update({ since: e.target.value })}
          />
        </div>
        {invalidKey != null && (
          <div className="text-danger small mb-2" role="alert">
            {t(invalidKey)}
          </div>
        )}
        <button type="submit" className="btn btn-primary">
          {t('admin:backlinks_backfill.start')}
        </button>
      </fieldset>
    </form>
  );
};
