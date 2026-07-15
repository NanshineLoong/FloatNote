/** Coordinates configuration changes with commands that need an AI model. */
export function createConfigurationGate() {
  let tail = Promise.resolve();
  let initialized = false;
  let resolveInitialized!: () => void;
  const initialization = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    run<T>(operation: () => Promise<T> | T): Promise<T> {
      const first = !initialized;
      initialized = true;
      const result = enqueue(operation);
      if (first) void result.finally(resolveInitialized).catch(() => {});
      return result;
    },
    initialize(operation: () => Promise<void> | void = () => {}): Promise<void> {
      return this.run(operation);
    },
    wait(): Promise<void> {
      return initialization.then(() => tail);
    },
  };
}
