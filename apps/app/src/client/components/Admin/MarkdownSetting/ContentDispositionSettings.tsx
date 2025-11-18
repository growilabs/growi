import React, { useState, useCallback } from 'react';

import { useContentDisposition } from '../../../services/admin-content-disposition';


/**
 * Helper function to ensure the mime type is normalized / clean before use.
 */
const normalizeMimeType = (mimeType: string): string => mimeType.trim().toLowerCase();

// REMINDER: Change so it sets the settings using an "Update" button, like the other settings do.
// Add remove button and reset button.
// Fix error handling, currently just logging.
// Make sure that the component is in the correct place (markdown settings?).

const ContentDispositionSettings: React.FC = () => {

  const {
    currentSettings,
    setInline,
    setAttachment,
  } = useContentDisposition();


  const [currentInput, setCurrentInput] = useState<string>('');


  const handleSetInline = useCallback(async(): Promise<void> => {
    const mimeType = normalizeMimeType(currentInput);
    if (mimeType) {
      try {
        await setInline(mimeType);
        setCurrentInput('');
      }
      catch (err) {
        console.error('Failed to set inline disposition:', err);
      }
    }
  }, [currentInput, setInline]);


  const handleSetAttachment = useCallback(async(): Promise<void> => {
    const mimeType = normalizeMimeType(currentInput);
    if (mimeType) {
      try {
        await setAttachment(mimeType);
        setCurrentInput('');
      }
      catch (err) {
        console.error('Failed to set attachment disposition:', err);
      }
    }
  }, [currentInput, setAttachment]);

  const inlineMimeTypes = currentSettings?.inlineMimeTypes ?? [];
  const attachmentMimeTypes = currentSettings?.attachmentMimeTypes ?? [];
  const renderInlineMimeTypes = inlineMimeTypes || [];
  const renderAttachmentMimeTypes = attachmentMimeTypes || [];

  return (
    <div style={{
      padding: '20px', border: '1px solid #ccc', borderRadius: '5px', maxWidth: '800px', margin: 'auto',
    }}
    >
      <h2>Content-Disposition Mime Type Settings ⚙️</h2>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          value={currentInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentInput(e.target.value)}
          placeholder="e.g., image/png"
          style={{
            padding: '10px', marginRight: '10px', width: '250px', border: '1px solid #ddd',
          }}
        />
        <button
          type="button"
          onClick={handleSetInline}
          style={{
            marginRight: '5px', background: '#4CAF50', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer',
          }}
        >
          Set Inline
        </button>
        <button
          type="button"
          onClick={handleSetAttachment}
          style={{
            background: '#008CBA', color: 'white', border: 'none', padding: '10px 18px', cursor: 'pointer',
          }}
        >
          Set Attachment
        </button>
      </div>

      <p style={{ fontSize: '12px', color: '#666' }}>
        Note: Setting a mime type will **automatically remove it** from the other list via the container logic.
      </p>

      <hr style={{ margin: '20px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>

        {/* INLINE List */}
        <div style={{ width: '48%' }}>
          <h3>Inline Mime Types (Viewable)</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {renderInlineMimeTypes.map((mimeType: string) => (
              <li
                key={mimeType}
                style={{
                  background: '#e0ffe0', padding: '8px', margin: '5px 0', borderRadius: '3px', borderLeft: '3px solid #4CAF50',
                }}
              >
                {mimeType}
              </li>
            ))}
          </ul>
        </div>

        {/* ATTACHMENT List */}
        <div style={{ width: '48%' }}>
          <h3>Attachment Mime Types (Forces Download)</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {renderAttachmentMimeTypes.map((mimeType: string) => (
              <li
                key={mimeType}
                style={{
                  background: '#e0f7ff', padding: '8px', margin: '5px 0', borderRadius: '3px', borderLeft: '3px solid #008CBA',
                }}
              >
                {mimeType}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ContentDispositionSettings;
