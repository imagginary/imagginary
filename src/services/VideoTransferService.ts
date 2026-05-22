/**
 * Phase 6E — VideoTransferService
 *
 * Orchestrates video-to-pose transfer:
 *   1. Validate uploaded video (format, duration, basic quality checks)
 *   2. Extract pose sequence frame-by-frame via IPC → ffmpeg + OpenPose/synthetic
 *   3. Apply pose sequence to a character image via ComfyUI ControlNet + Wan 2.2
 */

import { PoseKeyframe } from '../data/PoseVocabulary';
import { VideoValidationResult } from '../types';
import { buildPoseControlNetWorkflow } from './PoseEngineService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type { VideoValidationResult };

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUPPORTED_FORMATS = ['.mp4', '.mov', '.avi', '.webm'];
const MAX_DURATION_S = 30;

function getElectronAPI(): Record<string, (...args: unknown[]) => unknown> {
  return (window as any).electronAPI ?? {};
}

// ── Main Service ─────────────────────────────────────────────────────────────

class VideoTransferService {
  private comfyPort: number | null = null;

  private async getComfyPort(): Promise<number> {
    if (this.comfyPort) return this.comfyPort;
    const api = getElectronAPI();
    if (api.getComfyUIProxyPort) {
      this.comfyPort = (await api.getComfyUIProxyPort()) as number;
    }
    return this.comfyPort ?? 8188;
  }

  /**
   * Validate a video file before processing.
   * Returns warnings and quality score without touching the file if invalid.
   */
  async validateVideo(filePath: string): Promise<VideoValidationResult> {
    const api = getElectronAPI();
    if (!api.validateTransferVideo) {
      return {
        valid: false,
        duration: 0,
        frameCount: 0,
        warnings: [],
        estimatedQuality: 0,
        rejectionReason: 'Video validation not available in this environment',
      };
    }

    const raw = (await api.validateTransferVideo(filePath)) as {
      success: boolean;
      valid?: boolean;
      duration?: number;
      frameCount?: number;
      warnings?: string[];
      estimatedQuality?: number;
      rejectionReason?: string;
      error?: string;
    };

    if (!raw.success) {
      return {
        valid: false,
        duration: 0,
        frameCount: 0,
        warnings: [],
        estimatedQuality: 0,
        rejectionReason: raw.error ?? 'Validation failed',
      };
    }

    return {
      valid: raw.valid ?? false,
      duration: raw.duration ?? 0,
      frameCount: raw.frameCount ?? 0,
      warnings: raw.warnings ?? [],
      estimatedQuality: raw.estimatedQuality ?? 0,
      rejectionReason: raw.rejectionReason,
    };
  }

  /**
   * Extract a pose keyframe sequence from a video file.
   * Calls IPC to run ffmpeg frame extraction + OpenPose (or synthetic fallback).
   * Streams progress via callback.
   */
  async extractPoseSequence(
    videoPath: string,
    onProgress: (pct: number) => void
  ): Promise<{ sequence: PoseKeyframe[]; tempDir: string }> {
    const api = getElectronAPI();

    if (!api.extractTransferPoses) {
      throw new Error('Pose extraction not available in this environment');
    }

    // Subscribe to progress events before invoking
    let cleanup: (() => void) | undefined;
    if (api.onTransferPoseProgress) {
      cleanup = (api.onTransferPoseProgress as (cb: (d: { pct: number }) => void) => () => void)(
        (data) => onProgress(data.pct)
      );
    }

    try {
      const result = (await api.extractTransferPoses(videoPath)) as {
        success: boolean;
        sequence?: PoseKeyframe[];
        tempDir?: string;
        error?: string;
      };

      if (!result.success) {
        throw new Error(result.error ?? 'Pose extraction failed');
      }

      return {
        sequence: result.sequence ?? [],
        tempDir: result.tempDir ?? '',
      };
    } finally {
      cleanup?.();
    }
  }

  /**
   * Apply a pose sequence to a character image using ComfyUI ControlNet + Wan 2.2.
   * Returns a base64 video data URL.
   */
  async applyToCharacter(
    poseSequence: PoseKeyframe[],
    characterImagePath: string,
    motionPrompt: string,
    onProgress: (pct: number) => void
  ): Promise<string> {
    if (poseSequence.length === 0) {
      throw new Error('No pose sequence to apply');
    }

    onProgress(5);

    // Read the character image
    const api = getElectronAPI();
    let imageDataB64 = '';

    if (api.readImage) {
      const imageResult = (await api.readImage(characterImagePath)) as {
        success: boolean;
        data?: string;
        error?: string;
      };
      if (!imageResult.success || !imageResult.data) {
        throw new Error(`Could not read character image: ${imageResult.error ?? 'unknown error'}`);
      }
      // Strip data URL prefix if present
      imageDataB64 = imageResult.data.replace(/^data:[^;]+;base64,/, '');
    } else {
      throw new Error('Image reading not available in this environment');
    }

    onProgress(10);

    // Build the ControlNet temporal workflow
    const workflow = buildPoseControlNetWorkflow({
      imageDataB64,
      poseFrames: poseSequence,
      prompt: motionPrompt || 'cinematic character animation, smooth motion, storyboard style',
    });

    onProgress(20);

    // Queue in ComfyUI
    const port = await this.getComfyPort();
    const queueRes = await fetch(`http://127.0.0.1:${port}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!queueRes.ok) {
      const body = await queueRes.text();
      throw new Error(`ComfyUI rejected workflow: ${body}`);
    }

    const { prompt_id } = (await queueRes.json()) as { prompt_id: string };
    onProgress(25);

    // Poll for result
    return await this.pollForVideo(prompt_id, port, onProgress);
  }

  /** Poll /history until the prompt completes and return the video data URL. */
  private async pollForVideo(
    promptId: string,
    port: number,
    onProgress: (pct: number) => void
  ): Promise<string> {
    const POLL_INTERVAL = 2000;
    const MAX_WAIT = 8 * 60 * 1000; // 8 minutes for longer videos
    const start = Date.now();
    let pct = 25;

    while (Date.now() - start < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const histRes = await fetch(`http://127.0.0.1:${port}/history/${promptId}`);
      if (!histRes.ok) continue;

      const hist = (await histRes.json()) as Record<
        string,
        {
          outputs?: Record<
            string,
            { videos?: { filename: string; subfolder: string; type: string }[] }
          >;
        }
      >;

      const entry = hist[promptId];
      if (!entry?.outputs) {
        pct = Math.min(pct + 3, 92);
        onProgress(pct);
        continue;
      }

      const videoOutput = entry.outputs['9']?.videos?.[0];
      if (!videoOutput) {
        throw new Error('ComfyUI returned no video output. Check that VHS is installed.');
      }

      onProgress(93);
      const { filename, subfolder, type } = videoOutput;
      const viewUrl = `http://127.0.0.1:${port}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;

      const videoRes = await fetch(viewUrl);
      if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.statusText}`);

      const blob = await videoRes.blob();
      onProgress(98);

      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read video blob'));
        reader.readAsDataURL(blob);
      });
    }

    throw new Error('Video generation timed out after 8 minutes');
  }

  /** Delete the temporary frame directory after processing. */
  async cleanupTempFrames(tempDir: string): Promise<void> {
    if (!tempDir) return;
    const api = getElectronAPI();
    if (api.cleanupTransferFrames) {
      await (api.cleanupTransferFrames as (d: string) => Promise<void>)(tempDir);
    }
  }
}

export const videoTransferService = new VideoTransferService();
export { SUPPORTED_FORMATS, MAX_DURATION_S };
