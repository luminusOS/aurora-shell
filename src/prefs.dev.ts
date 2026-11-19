import type Adw from '@girs/adw-1';
import GeneralPreferences from './preferences/generalPreferences.ts';
import { createDeveloperPage } from './dev/preferencesPage.ts';

export default class DevelopmentPreferences extends GeneralPreferences {
  override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    await super.fillPreferencesWindow(window);
    window.add(createDeveloperPage(window));
  }
}
