import type Gio from '@girs/gio-2.0';

export function callAsync<T>(
  start: (callback: (_source: unknown, result: Gio.AsyncResult) => void) => void,
  finish: (result: Gio.AsyncResult) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    start((_source, result) => {
      try {
        resolve(finish(result));
      } catch (e) {
        reject(e);
      }
    });
  });
}
