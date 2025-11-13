import React, { type JSX, useState, useEffect } from 'react';

import { useTranslation } from 'next-i18next';

import { fetchInlineMimeMode, updateInlineMimeMode } from '~/client/services/admin-inline-mime-mode';
import { toastSuccess, toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

import type { InlineMimeMode } from '../../../../interfaces/inline-mime-mode';
import { InlineMimeModes } from '../../../../interfaces/inline-mime-mode';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import { ALL_MIME_TYPES } from './inlineMimeTypes/allMimeTypes';
import { STRICT_MIME_TYPES } from './inlineMimeTypes/strict';

const logger = loggerFactory('growi:importer');


export const InlineFileTypeSelector = (): JSX.Element => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inlineMimeMode, setInlineMimeMode] = useState<InlineMimeMode>(InlineMimeModes.STRICT);

  const { t } = useTranslation('admin');

  useEffect(() => {
    const fetchMode = async() => {
      try {
        const mode = await fetchInlineMimeMode();
        setInlineMimeMode(mode);

        switch (mode) {
          case InlineMimeModes.STRICT:
            setSelected(new Set(STRICT_MIME_TYPES));
            break;
          case InlineMimeModes.LAX:
            setSelected(new Set(ALL_MIME_TYPES));
            break;
          default:
            break;
        }
      }
      catch (err) {
        logger.error('Failed to fetch inlineMimeMode:', err);
      }
    };

    fetchMode();
  }, []);


  const inlineMimeModeChange = (selectedMode: InlineMimeMode) => {
    setInlineMimeMode(selectedMode);

    switch (selectedMode) {
      case InlineMimeModes.STRICT:
        setSelected(new Set(STRICT_MIME_TYPES));
        break;
      case InlineMimeModes.LAX:
        setSelected(new Set(ALL_MIME_TYPES));
        break;
      default:
        break;
    }
  };

  const toggleMime = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      }
      else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <>
      <div>
        <div className="form-check form-check-inline">
          {Object.values(InlineMimeModes).map(mimeMode => (
            <div className="form-check form-check-inline" key={mimeMode}>
              <input
                className="form-check-input"
                type="radio"
                name="inlineMimeMode"
                value={mimeMode}
                id={mimeMode}
                checked={inlineMimeMode === mimeMode}
                onChange={() => inlineMimeModeChange(mimeMode)}
              />
              <label className="form-check-label" htmlFor={mimeMode}>
                {t(`markdown_settings.inline_file_type_options.${mimeMode}`)}
              </label>
            </div>
          ))}

        </div>
      </div>
      <div className="dropdown">
        <button className="btn btn-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown">
          {t('markdown_settings.inline_file_type_options.permitted_file_types')}
        </button>
        <ul className="dropdown-menu">
          {ALL_MIME_TYPES.map((type) => {
            const id = `inline-${type.replace('/', '-')}`;
            return (
              <li key={type} onClick={e => e.stopPropagation()}>
                <div className="form-check form-switch mx-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={id}
                    checked={selected.has(type)}
                    disabled
                    onChange={() => toggleMime(type)}
                  />
                  <label className="form-check-label w-100" htmlFor={id}>
                    {type}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
        <AdminUpdateButtonRow
          onClick={async() => {
            try {
              await updateInlineMimeMode(inlineMimeMode);
              toastSuccess(t('markdown_settings.inline_file_type_options.inline_mime_mode_update_success'));
            }
            catch (err) {
              toastError(t('markdown_settings.inline_file_type_options.inline_mime_mode_update_failed'));
              logger.error(err);
            }
          }}
        />
      </div>
    </>
  );
};
