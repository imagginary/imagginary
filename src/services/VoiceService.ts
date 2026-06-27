// Phase 15 — Voice Layer (edge-tts)

export interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  language: string;    // BCP-47 locale, e.g. "en-US", "hi-IN"
  edgeVoice: string;   // edge-tts voice name, e.g. "en-US-ChristopherNeural"
  isCustom?: boolean;
  tier?: 'pro' | 'studio';
}

export interface EdgeVoice {
  name: string;    // e.g. "en-US-ChristopherNeural"
  gender: string;  // "Male" | "Female"
  locale: string;  // e.g. "en-US"
}

export interface EdgeTtsCheckResult {
  available: boolean;
  version?: string;
}

// Legacy alias so existing callers that import CoquiCheckResult still compile
export type CoquiCheckResult = EdgeTtsCheckResult;

export interface VoiceGenerationParams {
  text: string;
  voiceId: string;
  edgeVoice: string;
}

class VoiceService {
  async getAvailableVoices(): Promise<VoiceProfile[]> {
    try {
      const result = await window.electronAPI?.getVoiceLibrary?.();
      if (result?.success && Array.isArray(result.voices)) {
        return result.voices as VoiceProfile[];
      }
    } catch {
      // fall through to empty
    }
    return [];
  }

  async generateVoice(
    text: string,
    voiceId: string,
    voiceProfile: VoiceProfile,
    onProgress?: (pct: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let cleanup: (() => void) | undefined;

      if (onProgress && window.electronAPI?.onVoiceProgress) {
        cleanup = window.electronAPI.onVoiceProgress((pct: number) => onProgress(pct));
      }

      const params: VoiceGenerationParams = {
        text,
        voiceId,
        edgeVoice: voiceProfile.edgeVoice,
      };

      window.electronAPI?.generateVoice?.(params)
        .then((result: { success: boolean; wavPath?: string; error?: string }) => {
          cleanup?.();
          if (result.success && result.wavPath) {
            resolve(result.wavPath);
          } else {
            reject(new Error(result.error ?? 'Voice generation failed'));
          }
        })
        .catch((err: Error) => {
          cleanup?.();
          reject(err);
        });
    });
  }

  /** Live-generate a short preview clip for any edge-tts voice name */
  async previewVoice(edgeVoice: string): Promise<string> {
    const result = await window.electronAPI?.previewVoice?.({ edgeVoice });
    if (result?.success && result.previewPath) return result.previewPath;
    throw new Error(`Preview failed for: ${edgeVoice}`);
  }

  /** Fetch the full ~320-voice catalogue from edge-tts */
  async getAllEdgeVoices(): Promise<EdgeVoice[]> {
    try {
      const result = await window.electronAPI?.getEdgeTtsVoices?.();
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async cloneVoice(audioSamplePath: string, name: string): Promise<VoiceProfile> {
    const result = await window.electronAPI?.cloneVoice?.({ audioSamplePath, name });
    if (result?.success && result.profile) return result.profile as VoiceProfile;
    throw new Error(result?.error ?? 'Voice cloning failed');
  }

  async checkCoquiTTS(): Promise<EdgeTtsCheckResult> {
    const result = await window.electronAPI?.checkCoquiTTS?.();
    return result ?? { available: false };
  }

  async installCoquiTTS(onProgress?: (msg: string) => void): Promise<boolean> {
    let cleanup: (() => void) | undefined;

    if (onProgress && window.electronAPI?.onInstallProgress) {
      cleanup = window.electronAPI.onInstallProgress((msg: string) => onProgress(msg));
    }

    try {
      const result = await window.electronAPI?.installCoquiTTS?.();
      cleanup?.();
      return result?.success === true;
    } catch {
      cleanup?.();
      return false;
    }
  }
}

export const voiceService = new VoiceService();
