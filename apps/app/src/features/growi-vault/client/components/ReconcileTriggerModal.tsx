import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';
import {
  Alert,
  Button,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import type {
  ReconcileRejectReason,
  ReconcileSubmitResult,
} from '~/features/growi-vault/server/services/reconcile';

// ============================================================================
// Types
// ============================================================================

type ReconcileTargetType = 'page' | 'sub-tree';

type ReconcileAcceptedInfo = {
  reconcileId: string;
  descendantCount: number;
};

type ReconcileTriggerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** API endpoint — either `/v3/vault/reconcile` (admin) or `/v3/vault/page/reconcile` (user) */
  apiEndpoint: string;
  defaultTargetPath?: string;
  onAccepted?: (info: ReconcileAcceptedInfo) => void;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Modal for triggering a manual vault reconcile.
 * Supports selecting target type (page / sub-tree) and entering a target path.
 */
export const ReconcileTriggerModal = (
  props: ReconcileTriggerModalProps,
): JSX.Element => {
  const {
    isOpen,
    onClose,
    apiEndpoint,
    defaultTargetPath = '',
    onAccepted,
  } = props;

  const { t } = useTranslation('commons');

  const [targetType, setTargetType] = useState<ReconcileTargetType>('page');
  const [targetPath, setTargetPath] = useState<string>(defaultTargetPath);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [acceptedInfo, setAcceptedInfo] =
    useState<ReconcileAcceptedInfo | null>(null);

  const resetState = useCallback(() => {
    setTargetType('page');
    setTargetPath(defaultTargetPath);
    setSubmitting(false);
    setErrorMessage(null);
    setAcceptedInfo(null);
  }, [defaultTargetPath]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setErrorMessage(null);
    setAcceptedInfo(null);

    try {
      const res = await apiv3Post<{ data: ReconcileSubmitResult }>(
        apiEndpoint,
        { targetType, targetPath },
      );

      const result = res.data.data;

      if (result.status === 'accepted') {
        const info: ReconcileAcceptedInfo = {
          reconcileId: result.reconcileId,
          descendantCount: result.descendantCount,
        };
        setAcceptedInfo(info);
        onAccepted?.(info);
        // Keep modal open briefly to show accepted message, then auto-close
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        // Rejected — show i18n error message
        const reason = result.reason as ReconcileRejectReason;
        const i18nKey = `growi-vault.reconcile.rejected.${reason}`;
        setErrorMessage(t(i18nKey));
      }
    } catch {
      setErrorMessage(t('growi-vault.reconcile.rejected.invalid-target'));
    } finally {
      setSubmitting(false);
    }
  }, [apiEndpoint, handleClose, onAccepted, t, targetPath, targetType]);

  return (
    <Modal
      isOpen={isOpen}
      toggle={handleClose}
      data-testid="reconcile-trigger-modal"
    >
      <ModalHeader toggle={handleClose}>
        {t('growi-vault.reconcile.section.title')}
      </ModalHeader>

      <ModalBody>
        {/* Error alert */}
        {errorMessage != null && (
          <Alert color="danger" data-testid="reconcile-error-message">
            {errorMessage}
          </Alert>
        )}

        {/* Accepted feedback */}
        {acceptedInfo != null && (
          <Alert color="success" data-testid="reconcile-accepted-message">
            {t('growi-vault.reconcile.accepted.message')}
          </Alert>
        )}

        {/* Target type selection */}
        <FormGroup tag="fieldset">
          <legend className="col-form-label">
            {t('growi-vault.reconcile.target-type.legend')}
          </legend>
          <FormGroup check>
            <Input
              id="reconcile-target-type-page"
              type="radio"
              name="targetType"
              value="page"
              checked={targetType === 'page'}
              onChange={() => setTargetType('page')}
              disabled={submitting}
            />
            <Label check htmlFor="reconcile-target-type-page">
              {t('growi-vault.reconcile.target-type.page')}
            </Label>
          </FormGroup>
          <FormGroup check>
            <Input
              id="reconcile-target-type-subtree"
              type="radio"
              name="targetType"
              value="sub-tree"
              checked={targetType === 'sub-tree'}
              onChange={() => setTargetType('sub-tree')}
              disabled={submitting}
            />
            <Label check htmlFor="reconcile-target-type-subtree">
              {t('growi-vault.reconcile.target-type.sub-tree')}
            </Label>
          </FormGroup>
        </FormGroup>

        {/* Target path input */}
        <FormGroup>
          <Label htmlFor="reconcile-target-path">
            {t('growi-vault.reconcile.target-path.label')}
          </Label>
          <Input
            id="reconcile-target-path"
            type="text"
            placeholder="/path/to/page"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            disabled={submitting}
          />
        </FormGroup>
      </ModalBody>

      <ModalFooter>
        <Button
          color="primary"
          onClick={handleSubmit}
          disabled={submitting || targetPath.trim() === ''}
          data-testid="reconcile-submit-button"
        >
          {submitting ? (
            <>
              <span
                className="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              />
              {t('growi-vault.reconcile.submit.submitting')}
            </>
          ) : (
            t('growi-vault.reconcile.submit.start')
          )}
        </Button>
        <Button color="secondary" onClick={handleClose} disabled={submitting}>
          {t('growi-vault.reconcile.cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
