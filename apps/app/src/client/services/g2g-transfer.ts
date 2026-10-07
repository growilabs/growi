import { useCallback, useState } from 'react';

import { apiv3Post } from '~/client/util/apiv3-client';

export const useGenerateTransferKey = (): {
  transferKey: string;
  generateTransferKey: () => Promise<void>;
} => {
  const [transferKey, setTransferKey] = useState('');

  const generateTransferKey = useCallback(async () => {
    const response = await apiv3Post('/g2g-transfer/generate-key', {
      appSiteUrl: window.location.origin,
    });
    const { transferKey } = response.data;
    setTransferKey(transferKey);
  }, []);

  return { transferKey, generateTransferKey };
};
