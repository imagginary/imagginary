import { settingsService } from '../services/SettingsService';

export function getOllamaUrl(): string {
  return settingsService.getKey('ollamaUrl') || 'http://127.0.0.1:11434';
}

export function getComfyUIUrl(): string {
  return settingsService.getKey('comfyuiUrl') || 'http://127.0.0.1:8188';
}

export function getInstantMeshUrl(): string {
  return settingsService.getKey('instantMeshUrl') || 'http://127.0.0.1:7860';
}
