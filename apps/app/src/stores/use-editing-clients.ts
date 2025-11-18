import { useSWRStatic } from '@growi/core/dist/swr';
import type { EditingClient } from '@growi/editor';
import type { SWRResponse } from 'swr';

export const useEditingClients = (
  status?: EditingClient[],
): SWRResponse<EditingClient[], Error> => {
  return useSWRStatic<EditingClient[], Error>('editingUsers', status, {
    fallbackData: [],
  });
};
