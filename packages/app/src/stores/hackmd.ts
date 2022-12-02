import { SWRResponse } from 'swr';
import { useStaticSWR } from './use-static-swr';

type Nullable<T> = T | null;

export const usePageIdOnHackmd = (initialData?: Nullable<any>): SWRResponse<Nullable<any>, Error> => {
  return useStaticSWR<Nullable<any>, Error>('pageIdOnHackmd', initialData);
};


export const useHasDraftOnHackmd = (initialData?: Nullable<any>): SWRResponse<Nullable<any>, Error> => {
  return useStaticSWR<Nullable<any>, Error>('hasDraftOnHackmd', initialData);
};

export const useRevisionIdHackmdSynced = (initialData?: Nullable<any>): SWRResponse<Nullable<any>, Error> => {
  return useStaticSWR<Nullable<any>, Error>('revisionIdHackmdSynced', initialData);
};

export const useRemoteRevisionId = (initialData?: Nullable<any>): SWRResponse<Nullable<any>, Error> => {
  return useStaticSWR<Nullable<any>, Error>('remoteRevisionId', initialData);
};
