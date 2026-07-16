export async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) { const index = cursor; cursor += 1; results[index] = await worker(items[index], index); }
  }));
  return results;
}
