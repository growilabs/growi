import { EditorView } from '@codemirror/view';
import { useEffect } from 'react';

import type { UseCodeMirrorEditor } from '../../services';

export const useCustomizedButtonStyles = (
  codeMirrorEditor?: UseCodeMirrorEditor,
): void => {
  // Setup button styles
  useEffect(() => {
    if (codeMirrorEditor?.view == null) {
      return;
    }

    const updateButtonStyles = () => {
      const acceptButton = codeMirrorEditor.view?.dom.querySelector(
        'button[name="accept"]',
      );
      acceptButton?.classList.add('btn', 'btn-sm', 'btn-success');

      const rejectButton = codeMirrorEditor.view?.dom.querySelector(
        'button[name="reject"]',
      );
      rejectButton?.classList.add('btn', 'btn-sm', 'btn-outline-secondary');
      // Set button text
      if (rejectButton != null) {
        rejectButton.textContent = 'Discard';
      }
    };

    // Initial setup
    updateButtonStyles();

    // Setup listener for future updates
    const extension = EditorView.updateListener.of(() => {
      updateButtonStyles();
    });

    const cleanupFunction = codeMirrorEditor?.appendExtensions([extension]);
    return cleanupFunction;
  }, [codeMirrorEditor]);
};
