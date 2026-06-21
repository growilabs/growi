import { useEffect } from 'react';
import {
  getOriginalDoc,
  originalDocChangeEffect,
  unifiedMergeView,
  updateOriginalDoc,
} from '@codemirror/merge';
import type { StateEffect, Transaction } from '@codemirror/state';
import { ChangeSet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as Y from 'yjs';

import { deltaToChangeSpecs } from '../../../utils/delta-to-changespecs';
import type { UseCodeMirrorEditor } from '../../services';
import { useSecondaryYdocs } from '../../stores/use-secondary-ydocs';
import { useCustomizedButtonStyles } from './use-customized-button-styles';

// for avoiding apply update from primaryDoc to secondaryDoc twice
const SYNC_BY_ACCEPT_CHUNK = 'synkByAcceptChunk';

type Configuration = {
  pageId?: string;
};

export const useUnifiedMergeView = (
  isEnabled: boolean,
  codeMirrorEditor?: UseCodeMirrorEditor,
  configuration?: Configuration,
): void => {
  const { pageId } = configuration ?? {};

  const { primaryDoc, secondaryDoc } =
    useSecondaryYdocs(isEnabled, {
      pageId,
      useSecondary: isEnabled,
    }) ?? {};

  useCustomizedButtonStyles(codeMirrorEditor);

  // setup unifiedMergeView
  useEffect(() => {
    if (
      !isEnabled ||
      primaryDoc == null ||
      secondaryDoc == null ||
      codeMirrorEditor == null
    ) {
      return;
    }

    const extension = isEnabled
      ? [
          unifiedMergeView({
            original: codeMirrorEditor.getDoc(),
          }),
        ]
      : [];

    const cleanupFunction = codeMirrorEditor?.appendExtensions(extension);
    return cleanupFunction;
  }, [isEnabled, codeMirrorEditor, primaryDoc, secondaryDoc]);

  // Setup sync from primaryDoc to secondaryDoc
  useEffect(() => {
    if (
      !isEnabled ||
      primaryDoc == null ||
      secondaryDoc == null ||
      codeMirrorEditor == null
    ) {
      return;
    }

    const primaryYText = primaryDoc.getText('codemirror');

    const sync = (event: Y.YTextEvent) => {
      if (event.transaction.local) return;

      // avoid apply update from primaryDoc to secondaryDoc twice
      if (event.transaction.origin === SYNC_BY_ACCEPT_CHUNK) return;

      if (codeMirrorEditor?.view?.state == null) {
        return;
      }

      // sync from primaryDoc to secondaryDoc
      Y.applyUpdate(secondaryDoc, Y.encodeStateAsUpdate(primaryDoc));

      // sync from primaryDoc to original document
      if (codeMirrorEditor?.view?.state != null) {
        const changeSpecs = deltaToChangeSpecs(event.delta);
        const originalDoc = getOriginalDoc(codeMirrorEditor.view.state);
        const changeSet = ChangeSet.of(changeSpecs, originalDoc.length);
        const effect = originalDocChangeEffect(
          codeMirrorEditor.view.state,
          changeSet,
        );

        // Dispatch in next tick to ensure state is updated
        setTimeout(() => {
          codeMirrorEditor.view?.dispatch({
            effects: effect,
          });
        }, 0);
      }
    };

    primaryYText.observe(sync);

    // cleanup
    return () => {
      primaryYText.unobserve(sync);
    };
  }, [codeMirrorEditor, isEnabled, primaryDoc, secondaryDoc]);

  // Setup sync from secondaryDoc to primaryDoc when accepting chunks
  useEffect(() => {
    if (
      !isEnabled ||
      primaryDoc == null ||
      secondaryDoc == null ||
      codeMirrorEditor == null
    ) {
      return;
    }

    const extension = EditorView.updateListener.of((update) => {
      // Find updateOriginalDoc effect which is dispatched when a chunk is accepted
      const updateOrigEffect = update.transactions
        .flatMap<StateEffect<Transaction>>((tr) => tr.effects)
        .find((e) => e.is(updateOriginalDoc));

      if (updateOrigEffect != null) {
        const primaryYText = primaryDoc.getText('codemirror');

        primaryDoc.transact(() => {
          // fromA/toA positions are absolute document positions
          updateOrigEffect.value.changes.iterChanges(
            (fromA, toA, _fromB, _toB, inserted) => {
              primaryYText.delete(fromA, toA - fromA);
              if (inserted.length > 0) {
                primaryYText.insert(fromA, inserted.toString());
              }
            },
          );
        }, SYNC_BY_ACCEPT_CHUNK);
      }
    });

    const cleanup = codeMirrorEditor?.appendExtensions([extension]);

    return () => {
      cleanup?.();
    };
  }, [codeMirrorEditor, isEnabled, primaryDoc, secondaryDoc]);
};
