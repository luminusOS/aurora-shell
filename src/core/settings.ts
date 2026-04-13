import Gio from '@girs/gio-2.0';

export interface SettingsManager {
  getBoolean(key: string): boolean;
  setBoolean(key: string, value: boolean): void;
  getString(key: string): string;
  setString(key: string, value: string): void;
  getInt(key: string): number;
  setInt(key: string, value: number): void;
  connect(signal: string, callback: () => void): number;
  disconnect(id: number): void;
  getSchema(schemaId: string): SettingsManager;
  getRawSettings(): Gio.Settings; // Needed for legacy Adw/GSettings bindings temporarily
}

export class GSettingsManager implements SettingsManager {
  constructor(private settings: Gio.Settings) {}

  getBoolean(key: string): boolean {
    return this.settings.get_boolean(key);
  }

  setBoolean(key: string, value: boolean): void {
    this.settings.set_boolean(key, value);
  }

  getString(key: string): string {
    return this.settings.get_string(key);
  }

  setString(key: string, value: string): void {
    this.settings.set_string(key, value);
  }

  getInt(key: string): number {
    return this.settings.get_int(key);
  }

  setInt(key: string, value: number): void {
    this.settings.set_int(key, value);
  }

  connect(signal: string, callback: () => void): number {
    return this.settings.connect(signal, callback);
  }

  disconnect(id: number): void {
    this.settings.disconnect(id);
  }

  getSchema(schemaId: string): SettingsManager {
    return new GSettingsManager(new Gio.Settings({ schema_id: schemaId }));
  }

  getRawSettings(): Gio.Settings {
    return this.settings;
  }
}
