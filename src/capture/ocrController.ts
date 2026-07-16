import Gio from '@girs/gio-2.0';
import type GdkPixbuf from '@girs/gdkpixbuf-2.0';
import GLib from '@girs/glib-2.0';
import type { SettingsManager } from '~/core/settings.ts';
import type { Point } from '~/capture/annotationModel.ts';
import {
  chooseOcrLanguages,
  parseTesseractLanguages,
  parseTesseractTsv,
  type OcrResult,
} from '~/capture/ocrLogic.ts';

const LANGUAGES_KEY = 'capture-tools-ocr-languages';

export class OcrUnavailableError extends Error {}

export class OcrController {
  private _installedLanguages: string[] | null = null;
  private _probePromise: Promise<boolean> | null = null;
  private _subprocess: Gio.Subprocess | null = null;
  private _runId = 0;

  constructor(private _settings: SettingsManager) {}

  get available(): boolean | null {
    if (this._installedLanguages === null) return null;
    return this._installedLanguages.length > 0;
  }

  async probe(): Promise<boolean> {
    if (this._probePromise) return this._probePromise;
    this._probePromise = this._probe();
    try {
      return await this._probePromise;
    } finally {
      this._probePromise = null;
    }
  }

  async recognize(pixbuf: GdkPixbuf.Pixbuf, scale: number, origin: Point): Promise<OcrResult> {
    if (!(await this.probe()))
      throw new OcrUnavailableError('Tesseract or its language data is not installed');

    this.cancel();
    const runId = this._runId;
    const path = GLib.build_filenamev([
      GLib.get_tmp_dir(),
      `aurora-capture-ocr-${GLib.uuid_string_random()}.png`,
    ]);

    try {
      if (!pixbuf.savev(path, 'png', [], []))
        throw new Error('Failed to save the temporary OCR image');

      const installed = this._installedLanguages ?? [];
      const languages = chooseOcrLanguages(
        this._settings.getString(LANGUAGES_KEY),
        GLib.get_language_names(),
        installed,
      );
      if (languages.length === 0)
        throw new OcrUnavailableError('No Tesseract language data is installed');

      const subprocess = Gio.Subprocess.new(
        ['tesseract', path, 'stdout', '-l', languages.join('+'), '--psm', '11', 'tsv'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      );
      this._subprocess = subprocess;
      const [, stdout, stderr] = await communicate(subprocess);
      if (runId !== this._runId) throw new Error('OCR was cancelled');
      if (!subprocess.get_successful()) {
        const message = stderr?.trim() || `Tesseract exited with ${subprocess.get_exit_status()}`;
        throw new Error(message);
      }
      return parseTesseractTsv(stdout ?? '', scale, origin);
    } finally {
      if (this._subprocess && runId === this._runId) this._subprocess = null;
      try {
        GLib.unlink(path);
      } catch {
        // The file may not have been created if capture failed early.
      }
    }
  }

  cancel(): void {
    this._runId++;
    if (!this._subprocess) return;
    try {
      this._subprocess.force_exit();
    } catch {
      // The process may already have exited between the check and force_exit().
    }
    this._subprocess = null;
  }

  destroy(): void {
    this.cancel();
    this._installedLanguages = null;
  }

  private async _probe(): Promise<boolean> {
    if (!GLib.find_program_in_path('tesseract')) {
      this._installedLanguages = [];
      return false;
    }

    const subprocess = Gio.Subprocess.new(
      ['tesseract', '--list-langs'],
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    const [, stdout] = await communicate(subprocess);
    this._installedLanguages = subprocess.get_successful()
      ? parseTesseractLanguages(stdout ?? '')
      : [];
    return this._installedLanguages.length > 0;
  }
}

function communicate(subprocess: Gio.Subprocess): Promise<[boolean, string | null, string | null]> {
  return new Promise((resolve, reject) => {
    subprocess.communicate_utf8_async(null, null, (_source, result) => {
      try {
        resolve(subprocess.communicate_utf8_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}
