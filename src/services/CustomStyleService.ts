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
      if (result?.success) {
        this.customStyles = result.styles ?? [];
        this.loaded = true;
      } else {
        // IPC returned but reported failure — do not mark as loaded so callers
        // can distinguish "not yet loaded" from "loaded successfully"
        console.warn('[CustomStyleService] getCustomStyles returned failure:', result);
      }
    } catch (err) {
      // Not running in Electron (tests / storybook), or IPC threw — stay empty
      console.warn('[CustomStyleService] Failed to load custom styles:', err);
    }
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
    const result = await window.electronAPI?.saveCustomStyle?.({ style });
    if (!result?.success) {
      throw new Error(`Failed to save custom style "${style.id}": ${result?.error ?? 'unknown error'}`);
    }
    // Update in-memory state only after a confirmed successful write
    this.customStyles = [
      ...this.customStyles.filter((s) => s.id !== style.id),
      style,
    ];
  }

  async deleteCustomStyle(styleId: string): Promise<void> {
    const result = await window.electronAPI?.deleteCustomStyle?.({ styleId });
    if (!result?.success) {
      throw new Error(`Failed to delete custom style "${styleId}": ${result?.error ?? 'unknown error'}`);
    }
    // Update in-memory state only after a confirmed successful deletion
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
