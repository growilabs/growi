import { useEffect, useState } from 'react';

import { flushSync } from 'react-dom';

export const usePrintMode = (): boolean => {
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    // force re-render on beforeprint
    const handleBeforePrint = () => flushSync(() => {
      setIsPrinting(true);
    });

    const handleAfterPrint = () => {
      setIsPrinting(false);
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  return isPrinting;
};
