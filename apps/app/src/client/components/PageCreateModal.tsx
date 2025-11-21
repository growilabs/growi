import React, {
  useEffect, useState, useMemo, useCallback,
} from 'react';

import path from 'path';


import { Origin } from '@growi/core';
import { pagePathUtils, pathUtils } from '@growi/core/dist/utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import { format } from 'date-fns/format';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, UncontrolledButtonDropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';
import { debounce } from 'throttle-debounce';

import { useCreateTemplatePage } from '~/client/services/create-page';
import { useCreatePage } from '~/client/services/create-page/use-create-page';
import { useToastrOnError } from '~/client/services/use-toastr-on-error';
import { useCurrentUser } from '~/states/global';
import { isSearchServiceReachableAtom } from '~/states/server-configurations';
import { usePageCreateModalStatus, usePageCreateModalActions } from '~/states/ui/modal/page-create';

import PagePathAutoComplete from './PagePathAutoComplete';

import styles from './PageCreateModal.module.scss';

const {
  isCreatablePage, isUsersHomepage,
} = pagePathUtils;

const PageCreateModal: React.FC = () => {
  const { t } = useTranslation();

  const currentUser = useCurrentUser();

  const { isOpened, path: pathname = '' } = usePageCreateModalStatus();
  const { close: closeCreateModal } = usePageCreateModalActions();

  const { create } = useCreatePage();
  const { createTemplate } = useCreateTemplatePage();

  const isReachable = useAtomValue(isSearchServiceReachableAtom);

  // Memoize computed values
  const userHomepagePath = useMemo(() => pagePathUtils.userHomepagePath(currentUser), [currentUser]);
  const isCreatable = useMemo(() => isCreatablePage(pathname) || isUsersHomepage(pathname), [pathname]);
  const pageNameInputInitialValue = useMemo(() => (isCreatable ? pathUtils.addTrailingSlash(pathname) : '/'), [isCreatable, pathname]);
  const now = useMemo(() => format(new Date(), 'yyyy/MM/dd'), []);
  const todaysParentPath = useMemo(
    () => [userHomepagePath, t('create_page_dropdown.todays.memo', { ns: 'commons' }), now].join('/'),
    [userHomepagePath, t, now],
  );

  const [todayInput, setTodayInput] = useState('');
  const [pageNameInput, setPageNameInput] = useState(pageNameInputInitialValue);
  const [template, setTemplate] = useState(null);
  const [isMatchedWithUserHomepagePath, setIsMatchedWithUserHomepagePath] = useState(false);

  const checkIsUsersHomepageDebounce = useMemo(() => {
    return debounce(1000, (input: string) => {
      setIsMatchedWithUserHomepagePath(isUsersHomepage(input));
    });
  }, []);

  useEffect(() => {
    if (isOpened) {
      checkIsUsersHomepageDebounce(pageNameInput);
    }
  }, [isOpened, checkIsUsersHomepageDebounce, pageNameInput]);

  const transitBySubmitEvent = useCallback((e, transitHandler) => {
    // prevent page transition by submit
    e.preventDefault();
    transitHandler();
  }, []);

  /**
   * change todayInput
   * @param {string} value
   */
  const onChangeTodayInputHandler = useCallback((value) => {
    setTodayInput(value);
  }, []);

  /**
   * change template
   * @param {string} value
   */
  const onChangeTemplateHandler = useCallback((value) => {
    setTemplate(value);
  }, []);

  /**
   * access today page
   */
  const createTodayPage = useCallback(async() => {
    const joinedPath = [todaysParentPath, todayInput].join('/');
    return create(
      {
        path: joinedPath, parentPath: todaysParentPath, wip: true, origin: Origin.View,
      },
      { onTerminated: closeCreateModal },
    );
  }, [closeCreateModal, create, todayInput, todaysParentPath]);

  /**
   * access input page
   */
  const createInputPage = useCallback(async() => {
    const targetPath = normalizePath(pageNameInput);
    const parentPath = path.dirname(targetPath);

    return create(
      {
        path: targetPath,
        parentPath,
        wip: true,
        origin: Origin.View,
      },
      { onTerminated: closeCreateModal },
    );
  }, [closeCreateModal, create, pageNameInput]);

  /**
   * access template page
   */
  const createTemplatePage = useCallback(async() => {

    const label = (template === 'children') ? '_template' : '__template';

    await createTemplate?.(label);
    closeCreateModal();
  }, [closeCreateModal, createTemplate, template]);

  const createTodaysMemoWithToastr = useToastrOnError(createTodayPage);
  const createInputPageWithToastr = useToastrOnError(createInputPage);
  const createTemplateWithToastr = useToastrOnError(createTemplatePage);

  const renderCreateTodayForm = useMemo(() => {
    if (!isOpened) {
      return <></>;
    }
    return (
      <div className="row">
        <fieldset className="col-12 mb-4">
          <h3 className="pb-2">{t('create_page_dropdown.todays.desc', { ns: 'commons' })}</h3>

          <div className="d-sm-flex align-items-center justify-items-between">

            <div className="d-flex align-items-center flex-fill flex-wrap flex-lg-nowrap">
              <div className="d-flex align-items-center text-nowrap">
                <span>{todaysParentPath}/</span>
              </div>
              <form className="mt-1 mt-lg-0 ms-lg-2 w-100" onSubmit={(e) => { transitBySubmitEvent(e, createTodaysMemoWithToastr) }}>
                <input
                  type="text"
                  className="page-today-input2 form-control w-100"
                  id="page-today-input2"
                  placeholder={t('Input page name (optional)')}
                  value={todayInput}
                  onChange={e => onChangeTodayInputHandler(e.target.value)}
                />
              </form>
            </div>

            <div className="d-flex justify-content-end mt-1 mt-sm-0">
              <button
                type="button"
                data-testid="btn-create-memo"
                className="grw-btn-create-page btn btn-outline-primary rounded-pill text-nowrap ms-3"
                onClick={createTodaysMemoWithToastr}
              >
                <span className="material-symbols-outlined">description</span>{t('Create')}
              </button>
            </div>

          </div>

        </fieldset>
      </div>
    );
  }, [isOpened, todaysParentPath, todayInput, t, onChangeTodayInputHandler, transitBySubmitEvent, createTodaysMemoWithToastr]);

  const renderInputPageForm = useMemo(() => {
    if (!isOpened) {
      return <></>;
    }
    return (
      <div className="row" data-testid="row-create-page-under-below">
        <fieldset className="col-12 mb-4">
          <h3 className="pb-2">{t('Create under')}</h3>

          <div className="d-sm-flex align-items-center justify-items-between">
            <div className="flex-fill">
              {isReachable
                ? (
                  <PagePathAutoComplete
                    initializedPath={pageNameInputInitialValue}
                    addTrailingSlash
                    onSubmit={createInputPageWithToastr}
                    onInputChange={value => setPageNameInput(value)}
                    autoFocus
                  />
                )
                : (
                  <form onSubmit={(e) => { transitBySubmitEvent(e, createInputPageWithToastr) }}>
                    <input
                      type="text"
                      value={pageNameInput}
                      className="form-control flex-fill"
                      placeholder={t('Input page name')}
                      onChange={e => setPageNameInput(e.target.value)}
                      required
                    />
                  </form>
                )}
            </div>

            <div className="d-flex justify-content-end mt-1 mt-sm-0">
              <button
                type="button"
                data-testid="btn-create-page-under-below"
                className="grw-btn-create-page btn btn-outline-primary rounded-pill text-nowrap ms-3"
                onClick={createInputPageWithToastr}
                disabled={isMatchedWithUserHomepagePath}
              >
                <span className="material-symbols-outlined">description</span>{t('Create')}
              </button>
            </div>

          </div>
          { isMatchedWithUserHomepagePath && (
            <p className="text-danger mt-2">Error: Cannot create page under /user page directory.</p>
          ) }

        </fieldset>
      </div>
    );
  }, [isOpened, isReachable, pageNameInputInitialValue, createInputPageWithToastr, pageNameInput, isMatchedWithUserHomepagePath, t, transitBySubmitEvent]);

  const renderTemplatePageForm = useMemo(() => {
    if (!isOpened) {
      return <></>;
    }
    return (
      <div className="row">
        <fieldset className="col-12">

          <h3 className="pb-2">
            {t('template.modal_label.Create template under')}<br />
            <code className="h6" data-testid="grw-page-create-modal-path-name">{pathname}</code>
          </h3>

          <div className="d-sm-flex align-items-center justify-items-between">

            <UncontrolledButtonDropdown id="dd-template-type" className="flex-fill text-center">
              <DropdownToggle id="template-type" caret>
                {template == null && t('template.option_label.select')}
                {template === 'children' && t('template.children.label')}
                {template === 'descendants' && t('template.descendants.label')}
              </DropdownToggle>
              <DropdownMenu>
                <DropdownItem onClick={() => onChangeTemplateHandler('children')}>
                  {t('template.children.label')} (_template)<br className="d-block d-md-none" />
                  <small className="text-muted text-wrap">- {t('template.children.desc')}</small>
                </DropdownItem>
                <DropdownItem onClick={() => onChangeTemplateHandler('descendants')}>
                  {t('template.descendants.label')} (__template) <br className="d-block d-md-none" />
                  <small className="text-muted">- {t('template.descendants.desc')}</small>
                </DropdownItem>
              </DropdownMenu>
            </UncontrolledButtonDropdown>

            <div className="d-flex justify-content-end mt-1 mt-sm-0">
              <button
                data-testid="grw-btn-edit-page"
                type="button"
                className="grw-btn-create-page btn btn-outline-primary rounded-pill text-nowrap ms-3"
                onClick={createTemplateWithToastr}
                disabled={template == null}
              >
                <span className="material-symbols-outlined">description</span>{t('Edit')}
              </button>
            </div>

          </div>

        </fieldset>
      </div>
    );
  }, [isOpened, pathname, template, onChangeTemplateHandler, createTemplateWithToastr, t]);

  return (
    <Modal
      size="lg"
      isOpen={isOpened}
      toggle={() => closeCreateModal()}
      data-testid="page-create-modal"
      className={`grw-create-page ${styles['grw-create-page']}`}
      autoFocus={false}
    >
      <ModalHeader tag="h4" toggle={() => closeCreateModal()}>
        {t('New Page')}
      </ModalHeader>
      <ModalBody>
        {renderCreateTodayForm}
        {renderInputPageForm}
        {renderTemplatePageForm}
      </ModalBody>
    </Modal>

  );
};


export default PageCreateModal;
