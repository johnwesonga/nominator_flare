export const writeText = (text, callback) => {
  if (!globalThis.navigator?.clipboard) {
    callback(false);
    return;
  }

  const value = new URL(text, globalThis.location?.origin).href;
  globalThis.navigator.clipboard.writeText(value).then(
    () => callback(true),
    () => callback(false),
  );
};
