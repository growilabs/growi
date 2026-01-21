import React, {
  useState, useCallback, useEffect, useMemo,
} from 'react';

import { useContentDisposition, type ContentDispositionSettings } from '../../../services/AdminContentDispositionSettings';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';


const normalizeMimeType = (mimeType: string): string => mimeType.trim().toLowerCase();

const removeMimeTypeFromArray = (array: string[], mimeType: string): string[] => (
  array.filter(m => m !== mimeType)
);

const ContentDispositionSettings: React.FC = () => {

  const {
    currentSettings,
    isLoading,
    isUpdating,
    updateSettings,
  } = useContentDisposition();

  const [pendingSettings, setPendingSettings] = useState<ContentDispositionSettings | null>(null);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentSettings) {
      setPendingSettings({
        inlineMimeTypes: [...currentSettings.inlineMimeTypes],
        attachmentMimeTypes: [...currentSettings.attachmentMimeTypes],
      });
      setError(null);
    }
  }, [currentSettings]);

  // Use the pending settings for display, falling back to an empty object if not loaded yet
  const displaySettings = pendingSettings ?? { inlineMimeTypes: [], attachmentMimeTypes: [] };

  // Calculate if there are differences between saved and pending state
  const hasPendingChanges = useMemo(() => {
    if (!currentSettings || !pendingSettings) return false;
    // Check if the mime type lists have changed
    return JSON.stringify(currentSettings.inlineMimeTypes.sort()) !== JSON.stringify(pendingSettings.inlineMimeTypes.sort())
           || JSON.stringify(currentSettings.attachmentMimeTypes.sort()) !== JSON.stringify(pendingSettings.attachmentMimeTypes.sort());
  }, [currentSettings, pendingSettings]);


  const handleSetMimeType = useCallback((disposition: 'inline' | 'attachment') => {
    const mimeType = normalizeMimeType(currentInput);
    if (!mimeType) return;

    setError(null);
    setPendingSettings((prev) => {
      if (!prev) return null;

      const newSettings = { ...prev };
      const otherDisposition = disposition === 'inline' ? 'attachment' : 'inline';

      // Add to the target list (if not already present)
      const targetKey = `${disposition}MimeTypes` as keyof ContentDispositionSettings;
      if (!newSettings[targetKey].includes(mimeType)) {
        newSettings[targetKey] = [...newSettings[targetKey], mimeType];
      }

      // Remove from the other list
      const otherKey = `${otherDisposition}MimeTypes` as keyof ContentDispositionSettings;
      newSettings[otherKey] = removeMimeTypeFromArray(newSettings[otherKey], mimeType);

      return newSettings;
    });
    setCurrentInput('');
  }, [currentInput]);

  const handleSetInline = useCallback(() => handleSetMimeType('inline'), [handleSetMimeType]);
  const handleSetAttachment = useCallback(() => handleSetMimeType('attachment'), [handleSetMimeType]);

  // Handler for removing from pending state
  const handleRemove = useCallback((mimeType: string, disposition: 'inline' | 'attachment') => {
    setError(null);
    setPendingSettings((prev) => {
      if (!prev) return null;
      const key = `${disposition}MimeTypes` as keyof ContentDispositionSettings;
      return {
        ...prev,
        [key]: removeMimeTypeFromArray(prev[key], mimeType),
      };
    });
  }, []);

  // Handler for updating pending change
  const handleUpdate = useCallback(async(): Promise<void> => {
    if (!pendingSettings || !hasPendingChanges || isUpdating) return;

    setError(null);
    try {
      await updateSettings(pendingSettings);
    }
    catch (err) {
      const errorMessage = (err instanceof Error) ? err.message : 'An unknown error occurred during update.';
      setError(`Failed to update settings: ${errorMessage}`);
    }
  }, [pendingSettings, hasPendingChanges, isUpdating, updateSettings]);

  if (isLoading && !currentSettings) {
    return <div>Loading content disposition settings...</div>;
  }

  const renderInlineMimeTypes = displaySettings.inlineMimeTypes;
  const renderAttachmentMimeTypes = displaySettings.attachmentMimeTypes;

  return (
    <div className="row">
      <div className="col-12">
        <h2 className="pb-2">Content-Disposition Mime Type Settings</h2>

        {/* INPUT SECTION */}
        <div className="card shadow-sm mb-4">
          <div className="card-body">
            <div className="form-group">
              <label className="form-label fw-bold">Add New Mime Type</label>
              <div className="d-flex align-items-center gap-2">
                <input
                  type="text"
                  className="form-control"
                  value={currentInput}
                  onChange={e => setCurrentInput(e.target.value)}
                  placeholder="e.g., image/png"
                />
                <button
                  className="btn btn-primary px-3"
                  type="button"
                  onClick={handleSetInline}
                  disabled={!currentInput.trim() || isUpdating}
                >
                  Inline
                </button>
                <button
                  className="btn btn-primary text-white px-3"
                  type="button"
                  onClick={handleSetAttachment}
                  disabled={!currentInput.trim() || isUpdating}
                >
                  Attachment
                </button>
              </div>
              <small className="form-text text-muted mt-2 d-block">
                Note: Adding a mime type will <strong>automatically remove it</strong> from the other list.
              </small>
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger">{error}</div>
        )}

        <div className="row">
          {/* INLINE LIST COLUMN */}
          <div className="col-md-6 col-sm-12 align-self-start">
            <div className="card">
              <div className="card-header"><span className="fw-bold">Inline Mime Types</span></div>
              <div className="card-body">
                <ul className="list-group list-group-flush">
                  {renderInlineMimeTypes.length === 0 && <li className="list-group-item text-muted">No inline types set.</li>}
                  {renderInlineMimeTypes.map((mimeType: string) => (
                    <li key={mimeType} className="list-group-item d-flex justify-content-between align-items-center">
                      <code>{mimeType}</code>
                      <button
                        type="button" // Fixes the lint error
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleRemove(mimeType, 'inline')}
                        disabled={isUpdating}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* ATTACHMENT LIST COLUMN */}
          <div className="col-md-6 col-sm-12 align-self-start">
            <div className="card">
              <div className="card-header"><span className="fw-bold">Attachment Mime Types</span></div>
              <div className="card-body">
                <ul className="list-group list-group-flush">
                  {renderAttachmentMimeTypes.length === 0 && <li className="list-group-item text-muted">No attachment types set.</li>}
                  {renderAttachmentMimeTypes.map((mimeType: string) => (
                    <li key={mimeType} className="list-group-item d-flex justify-content-between align-items-center">
                      <code>{mimeType}</code>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleRemove(mimeType, 'attachment')}
                        disabled={isUpdating}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

        </div>

        <AdminUpdateButtonRow
          onClick={handleUpdate}
          disabled={!hasPendingChanges || isUpdating}
        />
      </div>
    </div>
  );
};

export default ContentDispositionSettings;
