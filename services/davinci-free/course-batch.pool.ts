export async function runCourseBatchPool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  const run = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, run));
}
