import { settingsService } from './SettingsService';
import { licenseService, CREDIT_COSTS } from './LicenseService';

export interface LipSyncResult {
  videoUrl?: string;
  videoData?: string | null;
  error?: string;
}

class LipSyncService {
  async isAvailable(): Promise<boolean> {
    // BYOK key still works; baked-in key presence is checked in main process
    return !!(settingsService.getKey('syncsoApiKey') || (window as any).electronAPI?.syncsoLipSync);
  }

  async generateLipSync(
    imageBase64: string,    // panel image, base64 PNG (no data URL prefix)
    audioPath: string,      // absolute path to WAV file
    onProgress?: (pct: number, msg: string) => void
  ): Promise<LipSyncResult | null> {
    if (!licenseService.hasCredits(CREDIT_COSTS.lipSync)) {
      return { error: 'insufficient_credits' };
    }

    // Read audio file as base64 via IPC
    onProgress?.(10, 'Uploading to Sync.so…');
    const audioBase64 = await (window as any).electronAPI.readFileAsBase64(audioPath);
    if (!audioBase64) return null;

    // Listen for progress events from main process poll loop
    let cleanupProgress: (() => void) | null = null;
    if ((window as any).electronAPI?.onCloudProgress) {
      cleanupProgress = (window as any).electronAPI.onCloudProgress(
        (data: { handler: string; pct: number; msg: string }) => {
          if (data.handler === 'syncso-lipsync') onProgress?.(data.pct, data.msg);
        }
      );
    }

    try {
      const result = await (window as any).electronAPI.syncsoLipSync({ imageBase64, audioBase64 });

      if (result?.videoUrl && !result.error) {
        await licenseService.spendCredits(CREDIT_COSTS.lipSync);
        return { videoUrl: result.videoUrl, videoData: null };
      }
      console.error('[LipSync] Error from main process:', result?.error);
      return null;
    } catch (err) {
      console.error('[LipSync] IPC error:', err);
      return null;
    } finally {
      cleanupProgress?.();
    }
  }
}

export const lipSyncService = new LipSyncService();
