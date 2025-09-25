import { useCallback, type RefObject, useRef } from 'react';

import type { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';

let defaultTop = 0;
const padding = 5;

const setDefaultTop = (top: number): void => {
  defaultTop = top;
};
const getDefaultTop = (): number => {
  return defaultTop + padding;
};


const getDataLine = (element: Element | null): number => {
  return element ? +(element.getAttribute('data-line') ?? '0') - 1 : 0;
};

const getEditorElements = (editorRootElement: HTMLElement): Array<Element> => {
  return Array.from(editorRootElement.getElementsByClassName('cm-line'))
    .filter((element) => { return !Number.isNaN(element.getAttribute('data-line') ?? Number.NaN) });
};

const getPreviewElements = (previewRootElement: HTMLElement): Array<Element> => {
  return Array.from(previewRootElement.getElementsByClassName('has-data-line'))
    .filter((element) => { return !Number.isNaN(element.getAttribute('data-line') ?? Number.NaN) });
};

// Ref: https://github.com/mikolalysenko/binary-search-bounds/blob/f436a2a8af11bf3208434e18bbac17e18e7a3a30/search-bounds.js
const elementBinarySearch = (list: Array<Element>, fn: (index: number) => boolean): number => {
  let ok = 0;
  let ng = list.length;
  while (ok + 1 < ng) {
    const mid = Math.floor((ok + ng) / 2);
    if (fn(mid)) {
      ok = mid;
    }
    else {
      ng = mid;
    }
  }
  return ok;
};

const findTopElementIndex = (elements: Array<Element>): number => {

  const find = (index: number): boolean => {
    return elements[index].getBoundingClientRect().top < getDefaultTop();
  };

  return elementBinarySearch(elements, find);
};

const findElementIndexFromDataLine = (previewElements: Array<Element>, dataline: number): number => {

  const find = (index: number): boolean => {
    return getDataLine(previewElements[index]) <= dataline;
  };

  return elementBinarySearch(previewElements, find);
};


type SourceElement = {
  start?: DOMRect,
  top?: DOMRect,
  next?: DOMRect,
}

type TargetElement = {
  start?: DOMRect,
  next?: DOMRect,
}

const calcScrollElementToTop = (element: Element): number => {
  return element.getBoundingClientRect().top - getDefaultTop();
};

const calcScorllElementByRatio = (sourceElement: SourceElement, targetElement: TargetElement): number => {
  if (sourceElement.start === sourceElement.next) {
    return 0;
  }
  if (sourceElement.start == null || sourceElement.top == null || sourceElement.next == null) {
    return 0;
  }
  if (targetElement.start == null || targetElement.next == null) {
    return 0;
  }
  const sourceAllHeight = sourceElement.next.top - sourceElement.start.top;
  const sourceOutHeight = sourceElement.top.top - sourceElement.start.top;
  const sourceTopHeight = getDefaultTop() - sourceElement.top.top;
  const sourceRaito = (sourceOutHeight + sourceTopHeight) / sourceAllHeight;

  const targetAllHeight = targetElement.next.top - targetElement.start.top;

  return targetAllHeight * sourceRaito;
};


const scrollEditor = (editorRootElement: HTMLElement, previewRootElement: HTMLElement): void => {

  setDefaultTop(editorRootElement.getBoundingClientRect().top);

  const editorElements = getEditorElements(editorRootElement);
  const previewElements = getPreviewElements(previewRootElement);

  const topEditorElementIndex = findTopElementIndex(editorElements);
  const topPreviewElementIndex = findElementIndexFromDataLine(previewElements, getDataLine(editorElements[topEditorElementIndex]));

  const startEditorElementIndex = findElementIndexFromDataLine(editorElements, getDataLine(previewElements[topPreviewElementIndex]));
  const nextEditorElementIndex = findElementIndexFromDataLine(editorElements, getDataLine(previewElements[topPreviewElementIndex + 1]));

  let newScrollTop = previewRootElement.scrollTop;

  if (previewElements[topPreviewElementIndex] == null) {
    return;
  }

  newScrollTop += calcScrollElementToTop(previewElements[topPreviewElementIndex]);
  newScrollTop += calcScorllElementByRatio(
    {
      start: editorElements[startEditorElementIndex]?.getBoundingClientRect(),
      top: editorElements[topEditorElementIndex]?.getBoundingClientRect(),
      next: editorElements[nextEditorElementIndex]?.getBoundingClientRect(),
    },
    {
      start: previewElements[topPreviewElementIndex]?.getBoundingClientRect(),
      next: previewElements[topPreviewElementIndex + 1]?.getBoundingClientRect(),
    },
  );

  previewRootElement.scrollTop = newScrollTop;

};

const scrollPreview = (editorRootElement: HTMLElement, previewRootElement: HTMLElement): void => {

  setDefaultTop(previewRootElement.getBoundingClientRect().y);

  const previewElements = getPreviewElements(previewRootElement);
  const editorElements = getEditorElements(editorRootElement);

  const topPreviewElementIndex = findTopElementIndex(previewElements);

  const startEditorElementIndex = findElementIndexFromDataLine(editorElements, getDataLine(previewElements[topPreviewElementIndex]));
  const nextEditorElementIndex = findElementIndexFromDataLine(editorElements, getDataLine(previewElements[topPreviewElementIndex + 1]));

  if (editorElements[startEditorElementIndex] == null) {
    return;
  }

  let newScrollTop = editorRootElement.scrollTop;

  newScrollTop += calcScrollElementToTop(editorElements[startEditorElementIndex]);
  newScrollTop += calcScorllElementByRatio(
    {
      start: previewElements[topPreviewElementIndex]?.getBoundingClientRect(),
      top: previewElements[topPreviewElementIndex]?.getBoundingClientRect(),
      next: previewElements[topPreviewElementIndex + 1]?.getBoundingClientRect(),
    },
    {
      start: editorElements[startEditorElementIndex]?.getBoundingClientRect(),
      next: editorElements[nextEditorElementIndex]?.getBoundingClientRect(),
    },
  );

  editorRootElement.scrollTop = newScrollTop;

};

// eslint-disable-next-line max-len
export const useScrollSync = (codeMirrorKey: GlobalCodeMirrorEditorKey, previewRef: RefObject<HTMLDivElement | null>): { scrollEditorHandler: () => void; scrollPreviewHandler: () => void } => {
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(codeMirrorKey);

  const isOriginOfScrollSyncEditor = useRef(false);
  const isOriginOfScrollSyncPreview = useRef(false);

  const scrollEditorHandler = useCallback(() => {
    if (codeMirrorEditor?.view?.scrollDOM == null || previewRef.current == null) {
      return;
    }

    if (isOriginOfScrollSyncPreview.current) {
      isOriginOfScrollSyncPreview.current = false;
      return;
    }

    isOriginOfScrollSyncEditor.current = true;
    scrollEditor(codeMirrorEditor.view.scrollDOM, previewRef.current);
  }, [codeMirrorEditor, isOriginOfScrollSyncPreview, previewRef]);

  const scrollPreviewHandler = useCallback(() => {
    if (codeMirrorEditor?.view?.scrollDOM == null || previewRef.current == null) {
      return;
    }

    if (isOriginOfScrollSyncEditor.current) {
      isOriginOfScrollSyncEditor.current = false;
      return;
    }

    isOriginOfScrollSyncPreview.current = true;
    scrollPreview(codeMirrorEditor.view.scrollDOM, previewRef.current);
  }, [codeMirrorEditor, isOriginOfScrollSyncEditor, previewRef]);

  return { scrollEditorHandler, scrollPreviewHandler };
};
