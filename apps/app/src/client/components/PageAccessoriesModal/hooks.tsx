import { useEffect, useState } from 'react';

import { usePageAccessoriesModalStatus, usePageAccessoriesModalActions, PageAccessoriesModalContents } from '~/states/ui/modal/page-accessories';

function getURLQueryParamValue(key: string) {
// window.location.href is page URL;
  const queryStr: URLSearchParams = new URL(window.location.href).searchParams;
  return queryStr.get(key);
}

// https://regex101.com/r/YHTDsr/1
const queryCompareFormat = /^([0-9a-f]{24})...([0-9a-f]{24})$/i;


export const useAutoOpenModalByQueryParam = (): void => {
  const [isArleadyMounted, setIsArleadyMounted] = useState(false);

  const status = usePageAccessoriesModalStatus();
  const { open: openPageAccessories } = usePageAccessoriesModalActions();

  useEffect(() => {
    if (isArleadyMounted) {
      return;
    }

    if (status == null || status.isOpened === true) {
      return;
    }

    const pageIdParams = getURLQueryParamValue('compare');
    if (pageIdParams != null) {
      const matches = pageIdParams.match(queryCompareFormat);

      if (matches == null) {
        return;
      }

      // open History
      openPageAccessories(PageAccessoriesModalContents.PageHistory);
    }

    setIsArleadyMounted(true);
  }, [openPageAccessories, status, isArleadyMounted]);

};

type ComparingRevisionIds = {
  sourceRevisionId: string,
  targetRevisionId: string,
}

export const useAutoComparingRevisionsByQueryParam = (): ComparingRevisionIds | null => {
  const [isArleadyMounted, setIsArleadyMounted] = useState(false);

  const [sourceRevisionId, setSourceRevisionId] = useState<string>();
  const [targetRevisionId, setTargetRevisionId] = useState<string>();

  useEffect(() => {
    if (isArleadyMounted) {
      return;
    }

    const pageIdParams = getURLQueryParamValue('compare');
    if (pageIdParams != null) {
      const matches = pageIdParams.match(queryCompareFormat);

      if (matches != null) {
        const [, source, target] = matches;
        setSourceRevisionId(source);
        setTargetRevisionId(target);
      }
    }

    setIsArleadyMounted(true);
  }, [isArleadyMounted]);

  return sourceRevisionId != null && targetRevisionId != null
    ? { sourceRevisionId, targetRevisionId }
    : null;
};
