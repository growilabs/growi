import React, { useMemo } from 'react';

import { useTranslation } from 'next-i18next';
import { Modal, ModalHeader, ModalBody } from 'reactstrap';

import { useShortcutsModalStatus, useShortcutsModalActions } from '~/states/ui/modal/shortcuts';

import styles from './ShortcutsModal.module.scss';


/**
 * ShortcutsModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
const ShortcutsModalSubstance = (): React.JSX.Element => {
  const { t } = useTranslation();
  const { close } = useShortcutsModalActions();

  // Memoize OS-specific class
  const additionalClassByOs = useMemo(() => {
    const platform = window.navigator.platform.toLowerCase();
    const isMac = (platform.indexOf('mac') > -1);
    return isMac ? 'mac' : 'win';
  }, []);

  // Memoize body content (large static JSX)
  const bodyContent = useMemo(() => {
    return (
      <div className="container">
        <div className="row">
          <div className="col-lg-6">
            <h6>
              <strong>{t('modal_shortcuts.global.title')}</strong>
            </h6>

            <ul className="list-unstyled m-0">
              {/* Open/Close shortcut help */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">
                  <span
                    className="text-nowrap"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: t('modal_shortcuts.global.Open/Close shortcut help') }}
                  />
                </div>
                <div className="d-flex align-items-center">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">/</span>
                </div>
              </li>
              {/* Create Page */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.global.Create Page')}</div>
                <div>
                  <span className="key">C</span>
                </div>
              </li>
              {/* Edit Page */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.global.Edit Page')}</div>
                <div>
                  <span className="key">E</span>
                </div>
              </li>
              {/* Search */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.global.Search')}</div>
                <div>
                  <span className="key">/</span>
                </div>
              </li>
              {/* Show Contributors */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">
                  <span
                    className="text-nowrap"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: t('modal_shortcuts.global.Show Contributors') }}
                  />
                </div>
                <div className="text-start">
                  <a href={t('modal_shortcuts.global.konami_code_url')} target="_blank" rel="noreferrer">
                    <span className="text-secondary small">
                      {t('modal_shortcuts.global.Konami Code')}
                    </span>
                  </a>
                  <div className="d-flex gap-2 flex-column align-items-start mt-1">
                    <div className="d-flex gap-1">
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_upward</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_upward</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_downward</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_downward</span>
                    </div>
                    <div className="d-flex gap-1">
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_back</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_forward</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_back</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_forward</span>
                    </div>
                    <div className="d-flex gap-1">
                      <span className="key">B</span>
                      <span className="key">A</span>
                    </div>
                  </div>
                </div>
              </li>
              {/* Mirror Mode */}
              <li className="d-flex align-items-center p-3">
                <div className="flex-grow-1">{t('modal_shortcuts.global.MirrorMode')}</div>
                <div className="text-start">
                  <a href={t('modal_shortcuts.global.konami_code_url')} target="_blank" rel="noreferrer">
                    <span className="text-secondary small">
                      {t('modal_shortcuts.global.Konami Code')}
                    </span>
                  </a>
                  <div className="d-flex gap-2 flex-column align-items-start mt-1">
                    <div className="d-flex gap-1">
                      <span className="key">X</span>
                      <span className="key">X</span>
                      <span className="key">B</span>
                      <span className="key">B</span>
                    </div>
                    <div className="d-flex gap-1">
                      <span className="key">A</span>
                      <span className="key">Y</span>
                      <span className="key">A</span>
                      <span className="key">Y</span>
                    </div>
                    <div className="d-flex gap-1">
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_downward</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_back</span>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div className="col-lg-6">
            <h6>
              <strong>{t('modal_shortcuts.editor.title')}</strong>
            </h6>
            <ul className="list-unstyled m-0">
              {/* Search in Editor */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.editor.Search in Editor')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">F</span>
                </div>
              </li>
              {/* Save Page */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">
                  {t('modal_shortcuts.editor.Save Page')}
                  <span className="small text-secondary ms-1">{t('modal_shortcuts.editor.Only Editor')}</span>
                </div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">S</span>
                </div>
              </li>
              {/* Indent */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.editor.Indent')}</div>
                <div>
                  <span className="key">Tab</span>
                </div>
              </li>
              {/* Outdent */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.editor.Outdent')}</div>
                <div className="text-nowrap gap-1">
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Tab</span>
                </div>
              </li>
              {/* Delete Line */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.editor.Delete Line')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">K</span>
                </div>
              </li>
              {/* Insert Line */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">
                  <span
                  // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: t('modal_shortcuts.editor.Insert Line') }}
                  />
                  <br />
                  <span className="small text-secondary ms-1">{t('modal_shortcuts.editor.Post Comment')}</span>
                </div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Enter</span>
                </div>
              </li>
              {/* Move Line */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.editor.Move Line')}</div>
                <div className="text-nowrap">
                  <span className={`key alt-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key material-symbols-outlined fs-5 px-0">arrow_downward</span>
                  <span className="text-secondary mx-2">or</span>
                  <span className="key material-symbols-outlined fs-5 px-0">arrow_upward</span>
                </div>
              </li>
              {/* Copy Line */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.editor.Copy Line')}</div>
                <div className="text-nowrap">
                  <div className="text-start">
                    <div>
                      <span className={`key alt-key ${additionalClassByOs}`}></span>
                      <span className="text-secondary mx-2">+</span>
                      <span className="key">Shift</span>
                      <span className="text-secondary ms-2">+</span>
                    </div>
                    <div className="mt-1">
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_downward</span>
                      <span className="text-secondary mx-2">or</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_upward</span>
                    </div>
                  </div>
                </div>
              </li>
              {/* Multiple Cursors */}
              <li className="d-flex align-items-center p-3">
                <div className="flex-grow-1">
                  {t('modal_shortcuts.editor.Multiple Cursors')}
                </div>
                <div className="text-nowrap">
                  <div className="text-end">
                    <div>
                      <span className={`key cmd-key ${additionalClassByOs}`}></span>
                      <span className="text-secondary mx-2">+</span>
                      <span className={`key alt-key ${additionalClassByOs}`}></span>
                      <span className="text-secondary ms-2">+</span>
                    </div>
                    <div className="mt-1">
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_downward</span>
                      <span className="text-secondary mx-2">or</span>
                      <span className="key material-symbols-outlined fs-5 px-0">arrow_upward</span>
                    </div>
                    <span className="small text-secondary">{t('modal_shortcuts.editor.Or Alt Click')}</span>

                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* Format settings section */}
        <div className="row mt-4">
          <div className="col-lg-6">
            <h6>
              <strong>{t('modal_shortcuts.format.title')}</strong>
            </h6>
            <ul className="list-unstyled m-0">
              {/* Bold */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.format.Bold')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">B</span>
                </div>
              </li>
              {/* Italic */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.format.Italic')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">I</span>
                </div>
              </li>
              {/* Strikethrough */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.format.Strikethrough')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">X</span>
                </div>
              </li>
              {/* Code Text */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.format.Code Text')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">C</span>
                </div>
              </li>
              {/* Hyperlink */}
              <li className="d-flex align-items-center p-3">
                <div className="flex-grow-1">{t('modal_shortcuts.format.Hyperlink')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">U</span>
                </div>
              </li>
            </ul>
          </div>

          <div className="col-lg-6">
            <h6>
              <strong>{t('modal_shortcuts.line_settings.title')}</strong>
            </h6>
            <ul className="list-unstyled m-0">
              {/* Simple List */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.line_settings.Numbered List')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">7</span>
                </div>
              </li>
              {/* Numbered List */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.line_settings.Bullet List')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">8</span>
                </div>
              </li>
              {/* Quote */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.line_settings.Quote')}</div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">Shift</span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">9</span>
                </div>
              </li>
              {/* Code Block */}
              <li className="d-flex align-items-center p-3 border-bottom">
                <div className="flex-grow-1">{t('modal_shortcuts.line_settings.Code Block')}</div>
                <div className="text-nowrap">
                  <div className="text-start">
                    <div>
                      <span className={`key cmd-key ${additionalClassByOs}`}></span>
                      <span className="text-secondary mx-2">+</span>
                      <span className={`key alt-key ${additionalClassByOs}`}></span>
                      <span className="text-secondary ms-2">+</span>
                    </div>
                    <div className="mt-1">
                      <span className="key">Shift</span>
                      <span className="text-secondary mx-2">+</span>
                      <span className="key">C</span>
                    </div>
                  </div>
                </div>
              </li>
              {/* Hide comments */}
              <li className="d-flex align-items-center p-3">
                <div className="flex-grow-1">
                  {t('modal_shortcuts.line_settings.Comment Out')}<br />
                  <span className="small text-secondary">{t('modal_shortcuts.line_settings.Comment Out Desc')}</span>
                </div>
                <div className="text-nowrap">
                  <span className={`key cmd-key ${additionalClassByOs}`}></span>
                  <span className="text-secondary mx-2">+</span>
                  <span className="key">/</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }, [additionalClassByOs, t]);

  return (
    <>
      <ModalHeader tag="h4" toggle={close} className="px-4">
        {t('Shortcuts')}
      </ModalHeader>
      <ModalBody className="p-md-4 mb-3 grw-modal-body-style overflow-auto">
        {bodyContent}
      </ModalBody>
    </>
  );
};

/**
 * ShortcutsModal - Container component (lightweight, always rendered)
 */
const ShortcutsModal = (): React.JSX.Element => {
  const status = useShortcutsModalStatus();
  const { close } = useShortcutsModalActions();

  return (
    <Modal id="shortcuts-modal" size="lg" isOpen={status?.isOpened ?? false} toggle={close} className={`shortcuts-modal ${styles['shortcuts-modal']}`}>
      {status?.isOpened && <ShortcutsModalSubstance />}
    </Modal>
  );
};

export default ShortcutsModal;
