import type { JSX } from 'react';

export interface IEditorMethods {
  forceToFocus: () => void;
  setValue: (newValue: string) => void;
  setCaretLine: (line: number) => void;
  setScrollTopByLine: (line: number) => void;
  insertText: (text: string) => void;
  terminateUploadingState: () => void;
}

export interface IEditorInnerMethods {
  getStrFromBol(): void;
  getStrToEol: () => void;
  getStrFromBolToSelectedUpperPos: () => void;
  replaceBolToCurrentPos: (text: string) => void;
  replaceLine: (text: string) => void;
  insertLinebreak: () => void;
  dispatchSave: () => void;
  dispatchPasteFiles: (event: Event) => void;
  getNavbarItems: () => JSX.Element[];
}
