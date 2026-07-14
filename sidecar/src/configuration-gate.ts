/** Coordinates configuration changes with commands that need an AI model. */
export function createConfigurationGate() {
  let tail = Promise.resolve();

  return {
    run<T>(operation: () => Promise<T> | T): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    wait(): Promise<void> {
      return tail;
    },
  };
}
