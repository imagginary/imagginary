/**
 * Phase 6B — PoseEngineService
 *
 * Orchestrates skeleton-guided image animation:
 *   1. Match a natural-language description to PoseTemplate(s)
 *   2. Interpolate a multi-keyframe sequence
 *   3. Build a ComfyUI ControlNet/Wan workflow payload
 *   4. Poll for completion and return a base64 video
 */

import {
  POSE_VOCABULARY,
  PoseTemplate,
  PoseKeyframe,
  Joint,
  SKELETON_CONNECTIONS,
  searchPoses,
} from '../data/PoseVocabulary';
import { getComfyUIUrl } from '../config/services';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PoseGenerationParams {
  /** Base image data URL (the storyboard panel). */
  imageData: string;
  /** User's natural-language description, e.g. "character runs then falls". */
  description: string;
  /** Selected pose template IDs (in order). */
  poseTemplateIds: string[];
  /** How many frames to interpolate between each keyframe pair (8–24). */
  framesPerSegment?: number;
  /** Progress callback — 0-100. */
  onProgress?: (pct: number, msg: string) => void;
}

export interface PoseGenerationResult {
  videoData: string;   // base64 data URL (video/mp4 or video/webp)
  videoPath: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Linear interpolation for a single joint, handling nulls. */
function lerpJoint(a: Joint | null, b: Joint | null, t: number): Joint | null {
  if (!a || !b) return t < 0.5 ? a : b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Easing functions. */
const easing = {
  linear: (t: number) => t,
  'ease-in': (t: number) => t * t,
  'ease-out': (t: number) => t * (2 - t),
  'ease-in-out': (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
};

/**
 * Interpolate between two keyframes producing `count` intermediate frames
 * (not including the start frame; including the end frame).
 */
export function interpolateKeyframes(
  from: PoseKeyframe,
  to: PoseKeyframe,
  count: number
): PoseKeyframe[] {
  const easeFn = easing[to.easing ?? 'ease-in-out'];
  const frames: PoseKeyframe[] = [];
  for (let i = 1; i <= count; i++) {
    const t = easeFn(i / count);
    const joints = from.joints.map((j, idx) => lerpJoint(j, to.joints[idx] ?? null, t));
    frames.push({ joints });
  }
  return frames;
}

/**
 * Resolve an ordered list of template IDs to PoseKeyframes, expanding
 * each template's optional `.sequence` or just using its `.keyframe`.
 */
export function buildKeyframeSequence(templateIds: string[]): PoseKeyframe[] {
  const sequence: PoseKeyframe[] = [];
  for (const id of templateIds) {
    const template = POSE_VOCABULARY.find((p) => p.id === id);
    if (!template) continue;
    if (template.sequence && template.sequence.length > 0) {
      sequence.push(...template.sequence);
    } else {
      sequence.push(template.keyframe);
    }
  }
  return sequence;
}

/**
 * Given a full sequence of PoseKeyframes, produce a dense frame list
 * by interpolating `framesPerSegment` frames between each adjacent pair.
 */
export function expandSequence(
  keyframes: PoseKeyframe[],
  framesPerSegment = 12
): PoseKeyframe[] {
  if (keyframes.length === 0) return [];
  if (keyframes.length === 1) return [keyframes[0]];

  const frames: PoseKeyframe[] = [keyframes[0]];
  for (let i = 0; i < keyframes.length - 1; i++) {
    frames.push(...interpolateKeyframes(keyframes[i], keyframes[i + 1], framesPerSegment));
  }
  return frames;
}

/**
 * Match pose template(s) from a natural-language description.
 * Returns up to `maxResults` templates, ranked by relevance.
 */
export function matchPoseTemplates(description: string, maxResults = 3): PoseTemplate[] {
  return searchPoses(description, maxResults);
}

// ── SVG Renderer ─────────────────────────────────────────────────────────────

/**
 * Render a single PoseKeyframe as an SVG string (for thumbnail or export).
 * `width` and `height` define the SVG viewport.
 */
export function renderPoseToSVG(
  keyframe: PoseKeyframe,
  width = 120,
  height = 160
): string {
  const joints = keyframe.joints;

  // Build joint circles
  const circles = joints
    .map((j, i) => {
      if (!j) return '';
      const cx = (j.x * width).toFixed(1);
      const cy = (j.y * height).toFixed(1);
      // Head joints (0-4) are slightly larger
      const r = i < 5 ? 3.5 : 2.5;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#a78bfa"/>`;
    })
    .join('');

  // Build skeleton lines
  const lines = SKELETON_CONNECTIONS.map(([a, b]) => {
    const ja = joints[a];
    const jb = joints[b];
    if (!ja || !jb) return '';
    const x1 = (ja.x * width).toFixed(1);
    const y1 = (ja.y * height).toFixed(1);
    const x2 = (jb.x * width).toFixed(1);
    const y2 = (jb.y * height).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7c3aed" stroke-width="2" stroke-linecap="round"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${lines}${circles}</svg>`;
}

/**
 * Render a single frame to a data URL for use in an <img> tag or canvas.
 */
export function renderPoseToDataURL(
  keyframe: PoseKeyframe,
  width = 120,
  height = 160
): string {
  const svg = renderPoseToSVG(keyframe, width, height);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ── ComfyUI Workflow Builder ─────────────────────────────────────────────────

/**
 * Build a ComfyUI workflow JSON for pose-controlled animation via Wan 2.2 + OpenPose ControlNet.
 *
 * Requires the following ComfyUI custom nodes:
 *   - ComfyUI-AnimateDiff-Evolved
 *   - comfyui_controlnet_aux (DWPose / OpenPose preprocessor)
 *   - ComfyUI-VideoHelperSuite (VHS)
 *
 * The workflow:
 *   1. Load the source image
 *   2. For each keyframe, encode pose as a conditioning map
 *   3. Run AnimateDiff with ControlNet guidance
 *   4. Output video via VHS
 */
export function buildPoseControlNetWorkflow(params: {
  imageDataB64: string;
  poseFrames: PoseKeyframe[];
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
}): object {
  const {
    imageDataB64,
    poseFrames,
    prompt,
    negativePrompt = 'blurry, distorted, watermark, text, bad anatomy',
    width = 512,
    height = 512,
    steps = 20,
    cfg = 7,
    seed = Math.floor(Math.random() * 2 ** 32),
  } = params;

  // Build pose conditioning maps as simple tensors described in JSON.
  // The actual tensor construction happens in the ComfyUI Python nodes —
  // we pass normalised joint coordinates and the node rebuilds the heatmap.
  const poseKeypoints = poseFrames.map((kf) => ({
    keypoints: kf.joints.map((j) => (j ? [j.x, j.y, 1.0] : [0, 0, 0])),
  }));

  return {
    '1': {
      class_type: 'LoadImageBase64',
      inputs: { image: imageDataB64 },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: prompt,
        clip: ['4', 1],
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negativePrompt,
        clip: ['4', 1],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'wan2.2_t2v_1.3B_bf16.safetensors' },
    },
    '5': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['1', 0], vae: ['4', 2] },
    },
    '6': {
      class_type: 'PoseKeyframeConditioningNode',
      inputs: {
        keypoints_json: JSON.stringify(poseKeypoints),
        width,
        height,
        model: ['4', 0],
        controlnet_name: 'control_v11p_sd15_openpose.pth',
        strength: 0.8,
      },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0],
        positive: ['6', 1],
        negative: ['3', 0],
        latent_image: ['5', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'euler_ancestral',
        scheduler: 'karras',
        denoise: 0.75,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['8', 0],
        frame_rate: 8,
        loop_count: 0,
        filename_prefix: 'pose_anim',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  };
}

// ── Main Service ─────────────────────────────────────────────────────────────

class PoseEngineService {
  private comfyBaseUrl: string | null = null;

  private async getComfyBaseUrl(): Promise<string> {
    if (this.comfyBaseUrl) return this.comfyBaseUrl;
    if (window.electronAPI?.getComfyUIProxyPort) {
      const port = await window.electronAPI.getComfyUIProxyPort();
      if (port) {
        this.comfyBaseUrl = `http://127.0.0.1:${port}`;
        return this.comfyBaseUrl;
      }
    }
    return getComfyUIUrl();
  }

  /** Check whether the required ComfyUI nodes are available. */
  async checkPoseNodes(): Promise<{ available: boolean; missing: string[] }> {
    try {
      const baseUrl = await this.getComfyBaseUrl();
      const res = await fetch(`${baseUrl}/object_info`);
      if (!res.ok) return { available: false, missing: ['ComfyUI not reachable'] };
      const info = await res.json() as Record<string, unknown>;
      const required = ['PoseKeyframeConditioningNode', 'VHS_VideoCombine', 'LoadImageBase64'];
      const missing = required.filter((n) => !info[n]);
      return { available: missing.length === 0, missing };
    } catch {
      return { available: false, missing: ['ComfyUI not reachable'] };
    }
  }

  /**
   * Primary method — generate a pose-animated video clip.
   */
  async generatePoseAnimation(params: PoseGenerationParams): Promise<PoseGenerationResult> {
    const {
      imageData,
      description,
      poseTemplateIds,
      framesPerSegment = 12,
      onProgress,
    } = params;

    const progress = (pct: number, msg: string) => onProgress?.(pct, msg);

    progress(0, 'Building keyframe sequence…');

    // 1. Resolve templates → keyframes
    const selectedIds = poseTemplateIds.length > 0
      ? poseTemplateIds
      : matchPoseTemplates(description).map((t) => t.id);

    if (selectedIds.length === 0) {
      throw new Error('No matching pose templates found. Try describing the pose differently.');
    }

    const baseKeyframes = buildKeyframeSequence(selectedIds);
    const denseFrames = expandSequence(baseKeyframes, framesPerSegment);

    progress(10, `${denseFrames.length} animation frames prepared…`);

    // 2. Build prompt from description + template tags
    const templateNames = selectedIds
      .map((id) => POSE_VOCABULARY.find((p) => p.id === id)?.name ?? '')
      .filter(Boolean)
      .join(', ');

    const enhancedPrompt = [
      description,
      `pose sequence: ${templateNames}`,
      'smooth motion, cinematic, storyboard style',
    ].join(', ');

    progress(15, 'Building ComfyUI workflow…');

    // 3. Strip the data:... prefix from the image
    const imageDataB64 = imageData.replace(/^data:[^;]+;base64,/, '');

    const workflow = buildPoseControlNetWorkflow({
      imageDataB64,
      poseFrames: denseFrames,
      prompt: enhancedPrompt,
    });

    progress(20, 'Sending to ComfyUI…');

    // 4. Queue the prompt
    const baseUrl = await this.getComfyBaseUrl();
    const queueRes = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!queueRes.ok) {
      const body = await queueRes.text();
      throw new Error(`ComfyUI rejected workflow: ${body}`);
    }

    const { prompt_id } = await queueRes.json() as { prompt_id: string };
    progress(25, 'Pose animation queued…');

    // 5. Poll for completion
    const videoData = await this.pollForResult(prompt_id, baseUrl, progress);

    progress(100, 'Pose animation complete');

    return { videoData, videoPath: null };
  }

  /** Poll /history until the prompt is done and return the video data URL. */
  private async pollForResult(
    promptId: string,
    baseUrl: string,
    onProgress: (pct: number, msg: string) => void
  ): Promise<string> {
    const POLL_INTERVAL = 2000;
    const MAX_WAIT = 5 * 60 * 1000; // 5 minutes
    const start = Date.now();
    let pct = 25;

    while (Date.now() - start < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const histRes = await fetch(`${baseUrl}/history/${promptId}`);
      if (!histRes.ok) continue;
      const hist = await histRes.json() as Record<string, { outputs?: Record<string, { videos?: { filename: string; subfolder: string; type: string }[] }> }>;

      const entry = hist[promptId];
      if (!entry?.outputs) {
        // Still running — advance progress indicator
        pct = Math.min(pct + 3, 90);
        onProgress(pct, 'Rendering pose animation…');
        continue;
      }

      // Find the video output from VHS_VideoCombine (node '9')
      const videoOutput = entry.outputs['9']?.videos?.[0];
      if (!videoOutput) {
        throw new Error('ComfyUI returned no video output. Check that VHS is installed.');
      }

      // Fetch the video file
      onProgress(93, 'Downloading video…');
      const { filename, subfolder, type } = videoOutput;
      const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;

      const videoRes = await fetch(viewUrl);
      if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.statusText}`);

      const blob = await videoRes.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read video blob'));
        reader.readAsDataURL(blob);
      });
    }

    throw new Error('Pose animation timed out after 5 minutes');
  }
}

export const poseEngineService = new PoseEngineService();
