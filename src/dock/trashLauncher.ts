export const TRASH_URI = 'trash://';

export type TrashLaunchResult = 'default-handler' | 'fallback-handler';

export interface TrashLaunchStrategy {
  launchDefaultHandler(): Promise<boolean>;
  launchFallbackHandler(): boolean;
}

export interface DefaultHandlerFile<Handler, AsyncResult, Cancellable> {
  query_default_handler_async(
    priority: number,
    cancellable: Cancellable,
    callback: (
      file: DefaultHandlerFile<Handler, AsyncResult, Cancellable>,
      result: AsyncResult,
    ) => void,
  ): void;
  query_default_handler_finish(result: AsyncResult): Handler;
}

/**
 * Promise adapter for Gio.File.query_default_handler_async(). The GIR typings
 * expose a Promise overload, but GJS only enables it after Gio._promisify().
 */
export function queryDefaultHandler<Handler, AsyncResult, Cancellable>(
  file: DefaultHandlerFile<Handler, AsyncResult, Cancellable>,
  priority: number,
  cancellable: Cancellable,
): Promise<Handler> {
  return new Promise((resolve, reject) => {
    file.query_default_handler_async(priority, cancellable, (source, result) => {
      try {
        resolve(source.query_default_handler_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Opens the trash through its location-specific handler, falling back to the
 * desktop file manager when GVfs cannot resolve a handler for trash://.
 */
export async function launchTrash(strategy: TrashLaunchStrategy): Promise<TrashLaunchResult> {
  let defaultError: unknown = null;

  try {
    if (await strategy.launchDefaultHandler()) return 'default-handler';
  } catch (error) {
    defaultError = error;
  }

  try {
    if (strategy.launchFallbackHandler()) return 'fallback-handler';
  } catch (fallbackError) {
    throw new Error(
      `default handler failed: ${String(defaultError)}; fallback failed: ${String(fallbackError)}`,
    );
  }

  throw new Error(
    defaultError
      ? `default handler failed: ${String(defaultError)}; fallback refused the URI`
      : 'default and fallback handlers refused the trash URI',
  );
}
