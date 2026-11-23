import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { callAsync } from '~/core/callAsync.ts';
import {
  matchesPreviewImageType,
  PREVIEW_IMAGE_MAX_BYTES,
  PREVIEW_IMAGE_PIXEL_BYTES,
  type PreviewImageType,
} from './linkPreviewImageFormat.ts';
import { IMAGE_SANDBOX_EXECUTABLES, imageSandboxArgs } from './linkPreviewImageSandbox.ts';

export function hasImageSandboxExecutables(): boolean {
  return IMAGE_SANDBOX_EXECUTABLES.every((path) =>
    GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE),
  );
}

export async function readPreviewBytes(
  input: Gio.InputStream,
  limit: number,
  cancel: Gio.Cancellable,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit);
  let count = 0;
  while (count < limit) {
    const size = Math.min(8192, limit - count);
    const bytes = await callAsync(
      (callback) => input.read_bytes_async(size, GLib.PRIORITY_DEFAULT, cancel, callback),
      (result) => input.read_bytes_finish(result),
    );
    const chunk = bytes.get_data();
    if (!chunk?.length) break;
    buffer.set(chunk, count);
    count += chunk.length;
  }
  return buffer.subarray(0, count);
}

export async function decodePreviewThumbnail(
  bytes: Uint8Array,
  type: PreviewImageType,
  cancel: Gio.Cancellable,
): Promise<GLib.Bytes | null> {
  if (
    cancel.is_cancelled() ||
    bytes.length > PREVIEW_IMAGE_MAX_BYTES ||
    !matchesPreviewImageType(bytes, type)
  )
    return null;

  // GdkPixbuf must not decode remote input in Shell, and exposes no bounded decoding service.
  const process = Gio.Subprocess.new(
    imageSandboxArgs(type),
    Gio.SubprocessFlags.STDIN_PIPE |
      Gio.SubprocessFlags.STDOUT_PIPE |
      Gio.SubprocessFlags.STDERR_SILENCE,
  );
  const cancelHandler = cancel.connect(() => process.force_exit());
  try {
    const input = process.get_stdin_pipe();
    const output = process.get_stdout_pipe();
    if (!input || !output) return null;

    const [, pixels] = await Promise.all([
      (async () => {
        await callAsync(
          (callback) => input.write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel, callback),
          (result) => input.write_all_finish(result),
        );
        await callAsync(
          (callback) => input.close_async(GLib.PRIORITY_DEFAULT, cancel, callback),
          (result) => input.close_finish(result),
        );
      })(),
      readPreviewBytes(output, PREVIEW_IMAGE_PIXEL_BYTES + 1, cancel),
    ]);
    if (pixels.length !== PREVIEW_IMAGE_PIXEL_BYTES) return null;

    const decoded = await callAsync(
      (callback) => process.wait_check_async(cancel, callback),
      (result) => process.wait_check_finish(result),
    );
    return decoded && !cancel.is_cancelled() ? new GLib.Bytes(pixels) : null;
  } finally {
    cancel.disconnect(cancelHandler);
    process.force_exit();
  }
}
