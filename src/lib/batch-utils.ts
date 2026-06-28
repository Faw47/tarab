export const _chunkArrayInternal = <T,>(items: T[], size: number): T[][] => {
  if (items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const runBatches = async <T, R>(
  items: T[],
  batchSize: number,
  worker: (batch: T[]) => Promise<R[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results: R[] = [];
  let done = 0;
  for (const batch of _chunkArrayInternal(items, batchSize)) {
    const batchResult = await worker(batch);
    results.push(...batchResult);
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return results;
};
