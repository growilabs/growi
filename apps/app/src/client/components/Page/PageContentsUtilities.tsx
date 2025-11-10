import { useTranslation } from 'next-i18next';

import { useUpdateStateAfterSave } from '~/client/services/page-operation';
import { useDrawioModalLauncherForView } from '~/client/services/side-effects/drawio-modal-launcher-for-view';
import { useHandsontableModalLauncherForView } from '~/client/services/side-effects/handsontable-modal-launcher-for-view';
import { toastSuccess, toastError, toastWarning } from '~/client/util/toastr';
import { PageUpdateErrorCode } from '~/interfaces/apiv3';
import { useCurrentPageId } from '~/states/page';


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
          toastWarning(t('modal_resolve_conflict.conflicts_with_new_body_on_server_side'));
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
          toastWarning(t('modal_resolve_conflict.conflicts_with_new_body_on_server_side'));
          return;
        }
      }

      toastError(errors);
    },
  });

  return null;
};
