import { licenseService, CREDIT_COSTS } from './LicenseService';

export interface LipSyncResult {
  videoUrl?: string;
  videoData?: string | null;
  error?: string;
}

class LipSyncService {
  async isAvailable(): Promise<boolean> {
    // Sync.so uses a baked-in API key (SYNCSO_API_KEY from config.json); availability
    // is confirmed by checking whether the IPC handler is exposed by the main process.
    // There is no BYOK option for Sync.so, so no settings key check is needed here.
    return !!window.electronAPI?.syncsoLipSync;
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
    const audioBase64 = await window.electronAPI!.readFileAsBase64(audioPath);
    if (!audioBase64) return null;

    // Listen for progress events from main process poll loop
    let cleanupProgress: (() => void) | null = null;
    if (window.electronAPI?.onCloudProgress) {
      cleanupProgress = window.electronAPI!.onCloudProgress(
        (data: { handler: string; pct: number; msg: string }) => {
          if (data.handler === 'syncso-lipsync') onProgress?.(data.pct, data.msg);
        }
      );
    }

    try {
      const result = await window.electronAPI!.syncsoLipSync({ imageBase64, audioBase64 });

      if (result?.videoUrl && !result.error) {
        // Credits were deducted atomically in the main process (deductCreditsAtomic).
        // Calling spendCredits() here would hit the spend-credits IPC handler and
        // deduct a SECOND time — 32 credits instead of 16. Refresh the cache instead.
        await licenseService.refreshBalanceFromStore();
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
