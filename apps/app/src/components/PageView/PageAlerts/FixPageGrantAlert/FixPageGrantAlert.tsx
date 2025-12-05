import { type JSX, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IResGrantData } from '~/interfaces/page-grant';
import { useCurrentUser } from '~/states/global';
import { useCurrentPageData } from '~/states/page';
import { useSWRxApplicableGrant, useSWRxCurrentGrantData } from '~/stores/page';

import { FixPageGrantModal } from './FixPageGrantModal';

type SubstanceProps = {
  pageId: string;
  currentAndParentPageGrantData: IResGrantData;
};

const FixPageGrantAlertSubstance = (props: SubstanceProps): JSX.Element => {
  const { t } = useTranslation();
  const { pageId, currentAndParentPageGrantData } = props;

  const { data: dataApplicableGrant } = useSWRxApplicableGrant(pageId);

  const [isOpen, setOpen] = useState<boolean>(false);

  if (dataApplicableGrant == null) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <>
      <div className="alert alert-warning py-3 ps-4 d-flex flex-column flex-lg-row">
        <div className="flex-grow-1 d-flex align-items-center">
          <span className="material-symbols-outlined mx-1" aria-hidden="true">
            error
          </span>
          {t('fix_page_grant.alert.description')}
        </div>
        <div className="d-flex align-items-end align-items-lg-center">
          <button
            type="button"
            className="btn btn-info btn-sm rounded-pill px-3"
            onClick={() => setOpen(true)}
          >
            {t('fix_page_grant.alert.btn_label')}
          </button>
        </div>
      </div>

      <FixPageGrantModal
        isOpen={isOpen}
        pageId={pageId}
        dataApplicableGrant={dataApplicableGrant}
        currentAndParentPageGrantData={currentAndParentPageGrantData}
        close={() => setOpen(false)}
      />
    </>
  );
};

export const FixPageGrantAlert = (): JSX.Element => {
  const currentUser = useCurrentUser();
  const pageData = useCurrentPageData();

  const hasParent = pageData?.parent != null ?? false;
  const pageId = pageData?._id;

  const { data: dataIsGrantNormalized } = useSWRxCurrentGrantData(
    currentUser != null ? pageId : null,
  );

  if (
    pageId == null ||
    !hasParent ||
    !dataIsGrantNormalized?.isGrantNormalized
  ) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <FixPageGrantAlertSubstance
      pageId={pageId}
      currentAndParentPageGrantData={dataIsGrantNormalized.grantData}
    />
  );
};
