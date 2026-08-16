export function setTimeout(milliseconds, callback) {
  globalThis.setTimeout(callback, milliseconds);
}
