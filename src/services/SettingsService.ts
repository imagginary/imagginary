import { AppSettings, DEFAULT_SETTINGS } from '../types';

const SETTINGS_KEY = 'imagginary_settings';

class SettingsService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  load(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  save(updates: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...updates };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  get(): AppSettings { return this.settings; }
  getKey(key: keyof AppSettings): string { return (this.settings[key] as string) ?? ''; }
}

export const settingsService = new SettingsService();
