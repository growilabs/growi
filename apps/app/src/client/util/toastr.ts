import type { ToastContent, ToastOptions } from 'react-toastify';
import { toast } from 'react-toastify';

import { toArrayIfNot } from '~/utils/array-utils';

export const toastErrorOption: ToastOptions = {
  autoClose: false,
  closeButton: true,
};
export const toastError = (
  err: string | Error | Error[],
  option: ToastOptions = toastErrorOption,
): void => {
  const errs = toArrayIfNot(err);

  if (errs.length === 0) {
    return;
  }

  for (const err of errs) {
    const message = typeof err === 'string' ? err : err.message;
    toast.error(message, option);
  }
};

export const toastSuccessOption: ToastOptions = {
  autoClose: 2000,
  closeButton: true,
};
export const toastSuccess = (
  content: ToastContent,
  option: ToastOptions = toastSuccessOption,
): void => {
  toast.success(content, option);
};

export const toastWarningOption: ToastOptions = {
  autoClose: 5000,
  closeButton: true,
};
export const toastWarning = (
  content: ToastContent,
  option: ToastOptions = toastWarningOption,
): void => {
  toast.warning(content, option);
};
