import axios from '~/utils/axios';

import type { InlineMimeMode } from '~/interfaces/inline-mime-mode';


type GetResponse = {
  inlineMimeMode: InlineMimeMode;
};

export const fetchInlineMimeMode = async(): Promise<InlineMimeMode> => {
  const res = await fetch('/_api/v3/inline-mime-mode');
  const data: GetResponse = await res.json();
  return data.inlineMimeMode;
};


export const updateInlineMimeMode = async(mode: InlineMimeMode): Promise<void> => {
  await axios.put('/_api/v3/inline-mime-mode', { mode });
};
