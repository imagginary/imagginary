import { StyleProfile } from '../types';
import { STYLE_VAULT } from '../data/StyleVault';
import { comfyUIService } from './ComfyUIService';

class CustomStyleService {
  private customStyles: StyleProfile[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (!window.electronAPI?.getCustomStyles) return;
    try {
      const result = await window.electronAPI.getCustomStyles();
      if (result.success) {
        this.customStyles = result.styles ?? [];
      }
    } catch {
      // Not running in Electron (tests / storybook) — stay empty
    }
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getAllStyles(): StyleProfile[] {
    return [...STYLE_VAULT, ...this.customStyles];
  }

  getCustomStyles(): StyleProfile[] {
    return [...this.customStyles];
  }

  getStyleById(id: string): StyleProfile | undefined {
    return this.getAllStyles().find((s) => s.id === id);
  }

  async saveCustomStyle(style: StyleProfile): Promise<void> {
    await window.electronAPI.saveCustomStyle({ style });
    this.customStyles = [
      ...this.customStyles.filter((s) => s.id !== style.id),
      style,
    ];
  }

  async deleteCustomStyle(styleId: string): Promise<void> {
    await window.electronAPI.deleteCustomStyle({ styleId });
    this.customStyles = this.customStyles.filter((s) => s.id !== styleId);
    // Invalidate so the deleted LoRA doesn't appear in stale cache during this session
    comfyUIService.invalidateLoraCache();
  }

  updateCustomStyleStatus(styleId: string, updates: Partial<StyleProfile>): void {
    this.customStyles = this.customStyles.map((s) =>
      s.id === styleId ? { ...s, ...updates } : s
    );
  }
}

export const customStyleService = new CustomStyleService();
