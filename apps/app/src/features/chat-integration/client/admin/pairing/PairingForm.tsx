import { type JSX, useCallback, useId, useState } from 'react';
import { ModalBody } from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import {
  describePairingOutcome,
  type PairingOutcome,
} from './describe-pairing-outcome';

interface PairingFormState {
  readonly registrationCode: string;
  readonly proxyUri: string;
  readonly growiUri: string;
  readonly growiLabel: string;
}

const EMPTY_PAIRING_FORM: PairingFormState = {
  registrationCode: '',
  proxyUri: '',
  growiUri: '',
  growiLabel: '',
};

/** Pairing form: paste a registration code the proxy issued (task 7.3). Rendered inside `PairingSection`'s modal, so its state is dropped whenever the modal closes. */
export const PairingForm = ({
  encryptionConfigured,
  onPaired,
  onCancel,
}: {
  encryptionConfigured: boolean;
  onPaired: () => void;
  onCancel: () => void;
}): JSX.Element => {
  const [form, setForm] = useState<PairingFormState>(EMPTY_PAIRING_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // useId() output is safe here (id=/htmlFor= use getElementById, which does
  // not parse the colons useId() produces as CSS) -- see
  // apps/app/.claude/rules/ui-pitfalls.md. Only a reactstrap `target` prop
  // would be unsafe, and none of these fields use one.
  const registrationCodeId = useId();
  const proxyUriId = useId();
  const growiUriId = useId();
  const growiLabelId = useId();

  const handleChange = useCallback(
    (field: keyof PairingFormState) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
      },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      try {
        const res = await apiv3Post<PairingOutcome>(
          '/chat-integration/admin/pairing',
          form,
        );
        const outcome = res.data;
        if (outcome.status === 'paired') {
          toastSuccess(describePairingOutcome(outcome));
          onPaired();
        } else {
          toastError(describePairingOutcome(outcome));
        }
      } catch (err) {
        toastError(err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [form, onPaired],
  );

  return (
    <form onSubmit={handleSubmit}>
      <ModalBody>
        <div className="mb-2">
          <label className="form-label" htmlFor={registrationCodeId}>
            Registration code
          </label>
          <input
            id={registrationCodeId}
            type="text"
            className="form-control"
            value={form.registrationCode}
            onChange={handleChange('registrationCode')}
            required
          />
        </div>
        <div className="mb-2">
          <label className="form-label" htmlFor={proxyUriId}>
            Proxy URL
          </label>
          <input
            id={proxyUriId}
            type="text"
            className="form-control"
            value={form.proxyUri}
            onChange={handleChange('proxyUri')}
            required
          />
        </div>
        <div className="mb-2">
          <label className="form-label" htmlFor={growiUriId}>
            This GROWI's URL
          </label>
          <input
            id={growiUriId}
            type="text"
            className="form-control"
            value={form.growiUri}
            onChange={handleChange('growiUri')}
            required
          />
        </div>
        <div className="mb-0">
          <label className="form-label" htmlFor={growiLabelId}>
            Label to show the chat service
          </label>
          <input
            id={growiLabelId}
            type="text"
            className="form-control"
            value={form.growiLabel}
            onChange={handleChange('growiLabel')}
            required
          />
        </div>
      </ModalBody>
      <div className="modal-footer">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!encryptionConfigured || isSubmitting}
        >
          {isSubmitting ? 'Pairing…' : 'Pair'}
        </button>
      </div>
    </form>
  );
};
