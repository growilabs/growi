import React, {
  useState, useCallback, useEffect, useMemo,
} from 'react';

// Use the refactored hook and its exported type
import { useContentDisposition, type ContentDispositionSettings } from '../../../services/AdminContentDispositionSettings';

/**
 * Helper function to ensure the mime type is normalized / clean before use.
 */
const normalizeMimeType = (mimeType: string): string => mimeType.trim().toLowerCase();

// Helper to remove a mimeType from an array
const removeMimeTypeFromArray = (array: string[], mimeType: string): string[] => (
  array.filter(m => m !== mimeType)
);

const ContentDispositionSettings: React.FC = () => {

  // 1. Updated destructuring from the refactored hook
  const {
    currentSettings,
    isLoading,
    isUpdating,
    updateSettings,
  } = useContentDisposition();

  // 2. State for pending changes and input
  const [pendingSettings, setPendingSettings] = useState<ContentDispositionSettings | null>(null);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentSettings) {
      // Deep copy to prevent mutating the original settings object
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


  // 3. Handlers for setting (adding to pending state)
  const handleSetMimeType = useCallback((disposition: 'inline' | 'attachment') => {
    const mimeType = normalizeMimeType(currentInput);
    if (!mimeType) return;

    setError(null);
    setPendingSettings((prev) => {
      if (!prev) return null;

      const newSettings = { ...prev };
      const otherDisposition = disposition === 'inline' ? 'attachment' : 'inline';

      // 1. Add to the target list (if not already present)
      const targetKey = `${disposition}MimeTypes` as keyof ContentDispositionSettings;
      if (!newSettings[targetKey].includes(mimeType)) {
        newSettings[targetKey] = [...newSettings[targetKey], mimeType];
      }

      // 2. Remove from the other list
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

  // Handler for resetting to the last saved settings
  const handleReset = useCallback(() => {
    setError(null);
    if (currentSettings) {
      // Revert pending changes to the last fetched/saved state
      setPendingSettings({
        inlineMimeTypes: [...currentSettings.inlineMimeTypes],
        attachmentMimeTypes: [...currentSettings.attachmentMimeTypes],
      });
    }
  }, [currentSettings]);


  // 4. Handler for updating (saving to server)
  const handleUpdate = useCallback(async(): Promise<void> => {
    if (!pendingSettings || !hasPendingChanges || isUpdating) return;

    setError(null);
    try {
      await updateSettings(pendingSettings);
    }
    catch (err) {
      const errorMessage = (err instanceof Error) ? err.message : 'An unknown error occurred during update.';
      setError(`Failed to update settings: ${errorMessage}`);
      console.error('Failed to update settings:', err);
    }
  }, [pendingSettings, hasPendingChanges, isUpdating, updateSettings]);

  if (isLoading && !currentSettings) {
    return <div>Loading content disposition settings...</div>;
  }

  const renderInlineMimeTypes = displaySettings.inlineMimeTypes;
  const renderAttachmentMimeTypes = displaySettings.attachmentMimeTypes;

  // 5. Render logic
  return (
    <div>
      <h2>Content-Disposition Mime Type Settings ⚙️</h2>

      {/* Input and Add Buttons */}
      <div>
        <input
          type="text"
          value={currentInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentInput(e.target.value)}
          placeholder="e.g., image/png"
        />
        <button
          type="button"
          onClick={handleSetInline}
          disabled={!currentInput.trim() || isUpdating}
        >
          Add Inline
        </button>
        <button
          type="button"
          onClick={handleSetAttachment}
          disabled={!currentInput.trim() || isUpdating}
        >
          Add Attachment
        </button>
      </div>

      <p style={{ fontSize: '12px', color: '#666' }}>
        Note: Adding a mime type will **automatically remove it** from the other list if it exists there.
      </p>

      {/* Error Display */}
      {error && (
        <div>
          **Error:** {error}
        </div>
      )}

      {/* Update and Reset Buttons */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={!hasPendingChanges || isUpdating}
        >
          {isUpdating ? 'Updating...' : 'Update Settings'}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={!hasPendingChanges || isUpdating}
        >
          Reset Changes
        </button>
      </div>


      <hr />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>

        {/* INLINE List */}
        <div>
          <h3>Inline Mime Types (Viewable)</h3>
          <ul>
            {renderInlineMimeTypes.length === 0 && <li>No inline mime types set.</li>}
            {renderInlineMimeTypes.map((mimeType: string) => (
              <li
                key={mimeType}
              >
                {mimeType}
                <button
                  type="button"
                  onClick={() => handleRemove(mimeType, 'inline')}
                  disabled={isUpdating}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* ATTACHMENT List */}
        <div>
          <h3>Attachment Mime Types (Forces Download)</h3>
          <ul>
            {renderAttachmentMimeTypes.length === 0 && <li>No attachment mime types set.</li>}
            {renderAttachmentMimeTypes.map((mimeType: string) => (
              <li
                key={mimeType}
              >
                {mimeType}
                <button
                  type="button"
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
  );
};

export default ContentDispositionSettings;
