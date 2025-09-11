import {
  useState, useCallback, useEffect, useMemo, useRef,
} from 'react';

import type { SelectablePage } from '../../interfaces/selectable-page';
import { useAiAssistantManagementModal } from '../stores/ai-assistant';


type UseSelectedPages = {
  selectedPages: Map<string, SelectablePage>,
  selectedPagesRef: React.RefObject<Map<string, SelectablePage>>,
  selectedPagesArray: SelectablePage[],
  addPage: (page: SelectablePage) => void,
  removePage: (page: SelectablePage) => void,
}

export const useSelectedPages = (initialPages?: SelectablePage[]): UseSelectedPages => {
  const [selectedPages, setSelectedPages] = useState<Map<string, SelectablePage>>(new Map());
  const { data: aiAssistantManagementModalData } = useAiAssistantManagementModal();

  const selectedPagesRef = useRef(selectedPages);

  const selectedPagesArray = useMemo(() => {
    return Array.from(selectedPages.values());
  }, [selectedPages]);

  useEffect(() => {
    selectedPagesRef.current = selectedPages;
  }, [selectedPages]);

  useEffect(() => {
    // Initialize each time PageMode is changed
    if (initialPages != null && aiAssistantManagementModalData?.pageMode != null) {
      const initialMap = new Map<string, SelectablePage>();
      initialPages.forEach((page) => {
        if (page.path != null) {
          initialMap.set(page.path, page);
        }
      });
      setSelectedPages(initialMap);
    }
  }, [aiAssistantManagementModalData?.pageMode, initialPages]);

  const addPage = useCallback((page: SelectablePage) => {
    setSelectedPages((prev) => {
      const newMap = new Map(prev);
      if (page.path != null) {
        newMap.set(page.path, page);
      }
      return newMap;
    });
  }, []);

  const removePage = useCallback((page: SelectablePage) => {
    setSelectedPages((prev) => {
      const newMap = new Map(prev);
      if (page.path != null) {
        newMap.delete(page.path);
      }
      return newMap;
    });
  }, []);


  return {
    selectedPages,
    selectedPagesRef,
    selectedPagesArray,
    addPage,
    removePage,
  };
};
