// Phase 15 — Voice Layer (Part 1: Coqui TTS)

export interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  style: string;
  gender: 'male' | 'female';
  age: 'young' | 'adult' | 'aged' | 'elderly';
  accent: string;
  samplePath: string;
  isCustom: boolean;
  tier: 'pro' | 'studio';
  modelName?: string;
  speakerId?: string;
}

export interface CoquiCheckResult {
  available: boolean;
  version?: string;
  installCommand?: string;
}

export interface VoiceGenerationParams {
  text: string;
  voiceId: string;
  modelName: string;
  speakerId?: string;
  outputPath?: string;
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
        modelName: voiceProfile.modelName ?? 'tts_models/en/vctk/vits',
        speakerId: voiceProfile.speakerId,
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

  async previewVoice(voiceId: string): Promise<string> {
    const result = await window.electronAPI?.getVoiceSample?.(voiceId);
    if (result?.success && result.samplePath) return result.samplePath;
    throw new Error(`No sample available for voice: ${voiceId}`);
  }

  async cloneVoice(audioSamplePath: string, name: string): Promise<VoiceProfile> {
    const result = await window.electronAPI?.cloneVoice?.({ audioSamplePath, name });
    if (result?.success && result.profile) return result.profile as VoiceProfile;
    throw new Error(result?.error ?? 'Voice cloning failed');
  }

  async checkCoquiTTS(): Promise<CoquiCheckResult> {
    const result = await window.electronAPI?.checkCoquiTTS?.();
    return result ?? { available: false, installCommand: 'pip install TTS' };
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
