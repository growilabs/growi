import React, { useState, useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import { useContentDisposition, type ContentDispositionSettings } from '../../../services/admin-content-disposition';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

interface MimeTypeListProps {
  title: string;
  items: string[];
  emptyText: string;
  onRemove: (mimeType: string) => void;
  removeLabel: string;
  isUpdating: boolean;
}

const normalizeMimeType = (mimeType: string): string => mimeType.trim().toLowerCase();

const MimeTypeList = ({
  title, items, emptyText, onRemove, removeLabel, isUpdating,
}: MimeTypeListProps) => (
  <div className="col-md-6 col-sm-12 mb-4">
    <div className="card shadow-sm rounded-3">
      <div className="card-header bg-transparent fw-bold">{title}</div>
      <div className="card-body">
        <ul className="list-group list-group-flush">
          {items.length === 0 && <li className="list-group-item text-muted small border-0">{emptyText}</li>}
          {items.map((m: string) => (
            <li key={m} className="list-group-item d-flex justify-content-between align-items-center border-0 px-0">
              <code>{m}</code>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger rounded-3"
                onClick={() => onRemove(m)}
                disabled={isUpdating}
              >
                {removeLabel}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);

const ContentDispositionSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const {
    currentSettings, isLoading, isUpdating, updateSettings,
  } = useContentDisposition();

  const [currentInput, setCurrentInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const {
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { isDirty },
  } = useForm<ContentDispositionSettings>({
    defaultValues: {
      inlineMimeTypes: [],
      attachmentMimeTypes: [],
    },
  });

  useEffect(() => {
    if (currentSettings) {
      reset(currentSettings);
    }
  }, [currentSettings, reset]);

  const inlineMimeTypes = watch('inlineMimeTypes');
  const attachmentMimeTypes = watch('attachmentMimeTypes');

  const handleSetMimeType = useCallback((disposition: 'inline' | 'attachment') => {
    const mimeType = normalizeMimeType(currentInput);
    if (!mimeType) return;

    const otherDisposition = disposition === 'inline' ? 'attachment' : 'inline';

    const currentTargetList = watch(`${disposition}MimeTypes`);
    const currentOtherList = watch(`${otherDisposition}MimeTypes`);

    if (!currentTargetList.includes(mimeType)) {
      setValue(`${disposition}MimeTypes`, [...currentTargetList, mimeType], { shouldDirty: true });
    }

    setValue(
      `${otherDisposition}MimeTypes`,
      currentOtherList.filter(m => m !== mimeType),
      { shouldDirty: true },
    );

    setCurrentInput('');
    setError(null);
  }, [currentInput, setValue, watch]);

  const handleRemove = useCallback((mimeType: string, disposition: 'inline' | 'attachment') => {
    const currentList = watch(`${disposition}MimeTypes`);
    setValue(
      `${disposition}MimeTypes`,
      currentList.filter(m => m !== mimeType),
      { shouldDirty: true },
    );
  }, [setValue, watch]);

  const onSubmit = async(data: ContentDispositionSettings) => {
    try {
      setError(null);
      await updateSettings(data);
      reset(data);
    }
    catch (err) {
      setError((err as Error).message);
    }
  };

  if (isLoading && !currentSettings) return <div>Loading...</div>;

  return (
    <div className="row">
      <div className="col-12">
        <h2 className="mb-4 border-0">{t('markdown_settings.content-disposition_header')}</h2>

        <div className="card shadow-sm mb-4 rounded-3 border-0">
          <div className="card-body">
            <div className="form-group">
              <label className="form-label fw-bold">
                {t('markdown_settings.content-disposition_options.add_header')}
              </label>
              <div className="d-flex align-items-center gap-2 mb-3">
                <input
                  type="text"
                  className="form-control rounded-3 w-50"
                  value={currentInput}
                  onChange={e => setCurrentInput(e.target.value)}
                  placeholder="e.g. image/png"
                />
                <button
                  className="btn btn-primary px-3 flex-shrink-0 rounded-3 fw-bold"
                  type="button"
                  onClick={() => handleSetMimeType('inline')}
                  disabled={!currentInput.trim() || isUpdating}
                >
                  {t('markdown_settings.content-disposition_options.inline_button')}
                </button>
                <button
                  className="btn btn-primary text-white px-3 flex-shrink-0 rounded-3 fw-bold"
                  type="button"
                  onClick={() => handleSetMimeType('attachment')}
                  disabled={!currentInput.trim() || isUpdating}
                >
                  {t('markdown_settings.content-disposition_options.attachment_button')}
                </button>
              </div>
              <small className="form-text text-muted">
                {t('markdown_settings.content-disposition_options.note')}
              </small>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger rounded-3">{error}</div>}

        <div className="row">
          <MimeTypeList
            title={t('markdown_settings.content-disposition_options.inline_header')}
            items={inlineMimeTypes}
            emptyText={t('markdown_settings.content-disposition_options.no_inline')}
            onRemove={m => handleRemove(m, 'inline')}
            removeLabel={t('markdown_settings.content-disposition_options.remove_button')}
            isUpdating={isUpdating}
          />
          <MimeTypeList
            title={t('markdown_settings.content-disposition_options.attachment_header')}
            items={attachmentMimeTypes}
            emptyText={t('markdown_settings.content-disposition_options.no_attachment')}
            onRemove={m => handleRemove(m, 'attachment')}
            removeLabel={t('markdown_settings.content-disposition_options.remove_button')}
            isUpdating={isUpdating}
          />
        </div>

        <AdminUpdateButtonRow
          onClick={handleSubmit(onSubmit)}
          disabled={!isDirty || isUpdating}
        />
      </div>
    </div>
  );
};

export default ContentDispositionSettings;
