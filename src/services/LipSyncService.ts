import { settingsService } from './SettingsService';
import { licenseService } from './LicenseService';

export interface LipSyncResult {
  videoUrl?: string;
  videoData?: string | null;
  error?: string;
}

class LipSyncService {
  async isAvailable(): Promise<boolean> {
    return !!settingsService.getKey('syncsoApiKey');
  }

  async generateLipSync(
    imageBase64: string,    // panel image, base64 PNG (no data URL prefix)
    audioPath: string,      // absolute path to WAV file
    onProgress?: (pct: number, msg: string) => void
  ): Promise<LipSyncResult | null> {
    if (!licenseService.canUse('lipSyncClips')) {
      return { error: 'monthly_limit_reached' };
    }

    const apiKey = settingsService.getKey('syncsoApiKey');
    if (!apiKey) return null;

    try {
      onProgress?.(10, 'Uploading to Sync.so…');

      // Read audio file as base64 via IPC
      const audioBase64 = await (window as any).electronAPI.readFileAsBase64(audioPath);
      if (!audioBase64) return null;

      onProgress?.(20, 'Generating lip sync…');

      const res = await fetch('https://api.sync.so/v2/generate', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'lipsync-2',
          input: [
            { type: 'video', url: `data:image/png;base64,${imageBase64}` },
            { type: 'audio', url: `data:audio/wav;base64,${audioBase64}` },
          ],
          options: { output_format: 'mp4', sync_mode: 'bounce' },
        }),
      });

      if (!res.ok) {
        console.error('[LipSync] API error:', res.status);
        return null;
      }

      const job = await res.json() as { id: string };
      const jobId = job.id;

      onProgress?.(30, 'Processing…');

      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const poll = await fetch(`https://api.sync.so/v2/generate/${jobId}`, {
          headers: { 'x-api-key': apiKey },
        });
        const status = await poll.json() as { status: string; outputUrl?: string };
        const pct = 30 + Math.min(i * 1.5, 60);
        onProgress?.(pct, `Processing… ${status.status}`);
        if (status.status === 'completed') {
          onProgress?.(95, 'Finalising…');
          licenseService.incrementUsage('lipSyncClips');
          return { videoUrl: status.outputUrl ?? '', videoData: null };
        }
        if (status.status === 'failed') return null;
      }
      return null;
    } catch (err) {
      console.error('[LipSync] Error:', err);
      return null;
    }
  }
}

export const lipSyncService = new LipSyncService();
