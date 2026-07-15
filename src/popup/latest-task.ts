export interface LatestTaskQueue {
  schedule(task: (isCurrent: () => boolean) => Promise<void>): Promise<void>;
}

export function createLatestTaskQueue(): LatestTaskQueue {
  let revision = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    schedule(task) {
      const taskRevision = ++revision;
      const run = async () => {
        if (taskRevision !== revision) return;
        await task(() => taskRevision === revision);
      };
      const result = tail.catch(() => {}).then(run);
      tail = result.catch(() => {});
      return result;
    },
  };
}
