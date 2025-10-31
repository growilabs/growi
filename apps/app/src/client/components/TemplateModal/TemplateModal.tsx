import React, {
  useCallback, useEffect, useState, useMemo, type JSX,
} from 'react';

import assert from 'assert';

import type { Lang } from '@growi/core';
import { useTemplateModalStatus, useTemplateModalActions, type TemplateModalState } from '@growi/editor';
import {
  extractSupportedLocales, getLocalizedTemplate, type TemplateSummary,
} from '@growi/pluginkit/dist/v4';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  UncontrolledDropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
} from 'reactstrap';

import { useSWRxTemplate, useSWRxTemplates } from '~/features/templates/stores';
import { useSWRxPersonalSettings } from '~/stores/personal-settings';
import { usePreviewOptions } from '~/stores/renderer';
import loggerFactory from '~/utils/logger';

import Preview from '../PageEditor/Preview';

import { useFormatter } from './use-formatter';


import styles from './TemplateModal.module.scss';


const logger = loggerFactory('growi:components:TemplateModal');


function constructTemplateId(templateSummary: TemplateSummary): string {
  const defaultTemplate = templateSummary.default;

  return `${defaultTemplate.pluginId ?? ''}_${defaultTemplate.id}`;
}

type TemplateSummaryItemProps = {
  templateSummary: TemplateSummary,
  selectedLocale?: string,
  onClick?: () => void,
  isSelected?: boolean,
  usersDefaultLang?: Lang,
}

const TemplateListGroupItem: React.FC<TemplateSummaryItemProps> = ({
  templateSummary,
  onClick,
  isSelected,
  usersDefaultLang,
}) => {
  const localizedTemplate = getLocalizedTemplate(templateSummary, usersDefaultLang);
  const templateLocales = extractSupportedLocales(templateSummary);

  assert(localizedTemplate?.isValid);

  return (
    <a
      className={`list-group-item list-group-item-action ${isSelected ? 'active' : ''}`}
      onClick={onClick}
      aria-current="true"
    >
      <h4 className="mb-1 d-flex">
        <span className="d-inline-block text-truncate">{localizedTemplate.title}</span>
        {localizedTemplate.pluginId != null ? <span className="material-symbols-outlined me-1 ms-2 text-muted small">extension</span> : ''}
      </h4>
      <p className="mb-2">{localizedTemplate.desc}</p>
      { templateLocales != null && Array.from(templateLocales).map(locale => (
        <span key={locale} className="badge border rounded-pill text-muted me-1">{locale}</span>
      ))}
    </a>
  );
};


const TemplateDropdownItem: React.FC<TemplateSummaryItemProps> = ({
  templateSummary,
  onClick,
  usersDefaultLang,
}) => {

  const localizedTemplate = getLocalizedTemplate(templateSummary, usersDefaultLang);
  const templateLocales = extractSupportedLocales(templateSummary);

  assert(localizedTemplate?.isValid);

  return (
    <DropdownItem
      onClick={onClick}
      className="px-4 py-3"
    >
      <h4 className="mb-1 d-flex">
        <span className="d-inline-block text-truncate">{localizedTemplate.title}</span>
        {localizedTemplate.pluginId != null ? <span className="material-symbols-outlined me-1 ms-2 text-muted small">extension</span> : ''}
      </h4>
      <p className="mb-1 text-wrap">{localizedTemplate.desc}</p>
      { templateLocales != null && Array.from(templateLocales).map(locale => (
        <span key={locale} className="badge border rounded-pill text-muted me-1">{locale}</span>
      ))}
    </DropdownItem>
  );
};

type TemplateModalSubstanceProps = {
  templateModalStatus: TemplateModalState,
  close: () => void,
}

const TemplateModalSubstance = (props: TemplateModalSubstanceProps): JSX.Element => {
  const { templateModalStatus, close } = props;

  const { t } = useTranslation(['translation', 'commons']);

  const { data: personalSettingsInfo } = useSWRxPersonalSettings();
  const { data: rendererOptions } = usePreviewOptions();
  const { data: templateSummaries, isLoading } = useSWRxTemplates();

  const [selectedTemplateSummary, setSelectedTemplateSummary] = useState<TemplateSummary>();
  const [selectedTemplateLocale, setSelectedTemplateLocale] = useState<string>();

  const { data: selectedTemplateMarkdown } = useSWRxTemplate(selectedTemplateSummary, selectedTemplateLocale);

  const { format } = useFormatter();

  const usersDefaultLang = personalSettingsInfo?.lang;

  // Memoize heavy calculations
  const selectedLocalizedTemplate = useMemo(() => (
    getLocalizedTemplate(selectedTemplateSummary, usersDefaultLang)
  ), [selectedTemplateSummary, usersDefaultLang]);

  const selectedTemplateLocales = useMemo(() => (
    extractSupportedLocales(selectedTemplateSummary)
  ), [selectedTemplateSummary]);

  const submitHandler = useCallback((markdown?: string) => {
    if (markdown == null) {
      return;
    }

    if (templateModalStatus.onSubmit == null) {
      close();
      return;
    }

    templateModalStatus.onSubmit(format(selectedTemplateMarkdown));
    close();
  }, [close, format, selectedTemplateMarkdown, templateModalStatus]);

  const onClickHandler = useCallback((
      templateSummary: TemplateSummary,
  ) => {
    let localeToSet: string | Lang | undefined;

    if (selectedTemplateLocale != null && selectedTemplateLocale in templateSummary) {
      localeToSet = selectedTemplateLocale;
    }
    else if (usersDefaultLang != null && usersDefaultLang in templateSummary) {
      localeToSet = usersDefaultLang;
    }
    else {
      localeToSet = undefined;
    }

    setSelectedTemplateLocale(localeToSet);
    setSelectedTemplateSummary(templateSummary);
  }, [selectedTemplateLocale, usersDefaultLang]);

  // Memoize handler creator to avoid recreating onClick functions in map
  const createOnClickHandler = useCallback((templateSummary: TemplateSummary) => () => {
    onClickHandler(templateSummary);
  }, [onClickHandler]);

  // Memoize locale handler creator
  const createLocaleHandler = useCallback((locale: string) => () => {
    setSelectedTemplateLocale(locale);
  }, []);

  useEffect(() => {
    if (!templateModalStatus.isOpened) {
      setSelectedTemplateSummary(undefined);
      setSelectedTemplateLocale(undefined);
    }
  }, [templateModalStatus.isOpened]);

  return (
    <div data-testid="template-modal">
      <ModalHeader tag="h4" toggle={close}>
        {t('template.modal_label.Select template')}
      </ModalHeader>
      <ModalBody className="container">
        <div className="row">
          {/* List Group */}
          <div className="d-none d-lg-block col-lg-4">

            { isLoading && (
              <div className="h-100 d-flex justify-content-center align-items-center">
                <LoadingSpinner className="mx-auto text-muted fs-3" />
              </div>
            ) }

            <div className="list-group">
              { templateSummaries != null && templateSummaries.map((templateSummary) => {
                const templateId = constructTemplateId(templateSummary);
                const isSelected = selectedTemplateSummary != null && constructTemplateId(selectedTemplateSummary) === templateId;

                return (
                  <TemplateListGroupItem
                    key={templateId}
                    templateSummary={templateSummary}
                    onClick={createOnClickHandler(templateSummary)}
                    isSelected={isSelected}
                    usersDefaultLang={usersDefaultLang}
                  />
                );
              }) }
            </div>
          </div>
          {/* Dropdown */}
          <div className="d-lg-none col mb-3">
            <UncontrolledDropdown>
              <DropdownToggle caret type="button" outline className="w-100 text-end" disabled={isLoading}>
                <span className="float-start">
                  { (() => {
                    if (isLoading) {
                      return 'Loading..';
                    }

                    return selectedLocalizedTemplate != null && selectedLocalizedTemplate.isValid
                      ? selectedLocalizedTemplate.title
                      : t('Select template');
                  })() }
                </span>
              </DropdownToggle>
              <DropdownMenu role="menu" className={`p-0 mw-100 ${styles['dm-templates']}`}>
                { templateSummaries != null && templateSummaries.map((templateSummary) => {
                  const templateId = constructTemplateId(templateSummary);

                  return (
                    <TemplateDropdownItem
                      key={templateId}
                      templateSummary={templateSummary}
                      onClick={createOnClickHandler(templateSummary)}
                      usersDefaultLang={usersDefaultLang}
                    />
                  );
                }) }
              </DropdownMenu>
            </UncontrolledDropdown>
          </div>
          <div className="col-12 col-lg-8">
            <div className="row mb-2 mb-lg-0">
              <div className="col-6">
                <h3>{t('preview')}</h3>
              </div>
              <div className="col-6 d-flex justify-content-end">
                <UncontrolledDropdown>
                  <DropdownToggle
                    caret
                    type="button"
                    outline
                    className="float-end"
                    disabled={selectedTemplateSummary == null}
                    data-testid="select-locale-dropdown-toggle"
                  >
                    <span className="float-start">{selectedTemplateLocale != null ? selectedTemplateLocale : t('Language')}</span>
                  </DropdownToggle>
                  <DropdownMenu className="dropdown-menu" role="menu">
                    { selectedTemplateLocales != null && Array.from(selectedTemplateLocales).map((locale) => {
                      return (
                        <DropdownItem
                          data-testid="select-locale-dropdown-item"
                          key={locale}
                          onClick={createLocaleHandler(locale)}
                        >
                          <span>{locale}</span>
                        </DropdownItem>
                      );
                    }) }
                  </DropdownMenu>
                </UncontrolledDropdown>
              </div>
            </div>
            <div className="card">
              <div className="card-body" style={{ height: '400px', overflowY: 'auto' }}>
                { rendererOptions != null && selectedTemplateSummary != null && (
                  <Preview rendererOptions={rendererOptions} markdown={format(selectedTemplateMarkdown)} />
                ) }
              </div>
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-outline-secondary mx-1" onClick={close}>
          {t('Cancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary mx-1"
          onClick={() => submitHandler(selectedTemplateMarkdown)}
          disabled={selectedTemplateSummary == null}
        >
          {t('commons:Insert')}
        </button>
      </ModalFooter>
    </div>
  );
};


export const TemplateModal = (): JSX.Element => {
  const templateModalStatus = useTemplateModalStatus();
  const { close } = useTemplateModalActions();

  if (templateModalStatus == null) {
    return <></>;
  }

  return (
    <Modal className="link-edit-modal" isOpen={templateModalStatus.isOpened} toggle={close} size="xl" autoFocus={false}>
      { templateModalStatus.isOpened && (
        <TemplateModalSubstance templateModalStatus={templateModalStatus} close={close} />
      ) }
    </Modal>
  );
};
