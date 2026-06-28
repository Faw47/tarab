import pLimit from 'p-limit';

export const ipcBatchLimit = pLimit(8);
