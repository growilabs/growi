import { useTranslation } from 'next-i18next';

import { PageUpdateErrorCode } from '~/interfaces/apiv3';
import { useCurrentPageId } from '~/states/page';

import { useUpdateStateAfterSave } from '../../services/page-operation';
import { useDrawioModalLauncherForView } from '../../services/side-effects/drawio-modal-launcher-for-view';
import { useHandsontableModalLauncherForView } from '../../services/side-effects/handsontable-modal-launcher-for-view';
import { toastError, toastSuccess, toastWarning } from '../../util/toastr';

export const PageContentsUtilities = (): null => {
  const { t } = useTranslation();

  const pageId = useCurrentPageId();
  const updateStateAfterSave = useUpdateStateAfterSave(pageId);

  useHandsontableModalLauncherForView({
    onSaveSuccess: () => {
      toastSuccess(t('toaster.save_succeeded'));

      updateStateAfterSave?.();
    },
    onSaveError: (errors) => {
      for (const error of errors) {
        if (error.code === PageUpdateErrorCode.CONFLICT) {
          toastWarning(
            t('modal_resolve_conflict.conflicts_with_new_body_on_server_side'),
          );
          return;
        }
      }

      toastError(errors);
    },
  });

  useDrawioModalLauncherForView({
    onSaveSuccess: () => {
      toastSuccess(t('toaster.save_succeeded'));

      updateStateAfterSave?.();
    },
    onSaveError: (errors) => {
      for (const error of errors) {
        if (error.code === PageUpdateErrorCode.CONFLICT) {
          toastWarning(
            t('modal_resolve_conflict.conflicts_with_new_body_on_server_side'),
          );
          return;
        }
      }

      toastError(errors);
    },
  });

  return null;
};
