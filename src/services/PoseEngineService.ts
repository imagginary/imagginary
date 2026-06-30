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
  SKELETON_CONNECTIONS,
  searchPoses,
} from '../data/PoseVocabulary';
import { getComfyUIUrl } from '../config/services';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PoseGenerationParams {
  /** Base image data URL (the storyboard panel). */
  imageData: string;
  /** User's natural-language description, e.g. "character raises arm defiantly". */
  description: string;
  /** Selected pose template IDs (in order). */
  poseTemplateIds: string[];
  /** Unused — kept for call-site compatibility. */
  framesPerSegment?: number;
  /** Progress callback — 0-100. */
  onProgress?: (pct: number, msg: string) => void;
}

export interface PoseGenerationResult {
  /** Base64 PNG data URL of the posed panel image. */
  imageData: string;
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
 * Render a single PoseKeyframe as an OpenPose-format PNG data URL.
 * Black background, colored joints and limb lines — compatible with
 * control_v11p_sd15_openpose.pth ControlNet.
 */
export function renderPoseToOpenposePNG(
  keyframe: PoseKeyframe,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // COCO 17-joint color palette (matches OpenPose convention)
  const JOINT_COLORS = [
    '#FF0000', '#FF5500', '#FFAA00', '#FFE600', '#AAFF00',
    '#00FF00', '#00FFAA', '#00FFFF', '#00AAFF', '#0055FF',
    '#5500FF', '#AA00FF', '#FF00AA', '#FF0055', '#FF6600',
    '#FF9900', '#FFCC00',
  ];

  // Draw limb lines first so joint circles render on top
  ctx.lineWidth = Math.max(2, Math.round(width / 150));
  SKELETON_CONNECTIONS.forEach(([a, b]) => {
    const ja = keyframe.joints[a];
    const jb = keyframe.joints[b];
    if (!ja || !jb) return;
    ctx.strokeStyle = JOINT_COLORS[a] ?? '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(ja.x * width, ja.y * height);
    ctx.lineTo(jb.x * width, jb.y * height);
    ctx.stroke();
  });

  // Draw joint circles
  const r = Math.max(3, Math.round(width / 100));
  keyframe.joints.forEach((joint, i) => {
    if (!joint) return;
    ctx.fillStyle = JOINT_COLORS[i] ?? '#FFFFFF';
    ctx.beginPath();
    ctx.arc(joint.x * width, joint.y * height, r, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas.toDataURL('image/png');
}

/**
 * Build a ComfyUI workflow for single-image pose-controlled generation.
 * Uses DreamShaper 8 (SD1.5) + ControlNet OpenPose — no custom nodes required.
 * Outputs a still image via SaveImage, not video.
 */
export function buildPoseControlNetWorkflow(
  panelImageB64: string,
  poseImageB64: string,
  prompt: string,
  seed = Math.floor(Math.random() * 2 ** 32),
): object {
  const panelB64 = panelImageB64.replace(/^data:[^;]+;base64,/, '');
  const poseB64 = poseImageB64.replace(/^data:[^;]+;base64,/, '');

  return {
    '1':  { class_type: 'LoadImageBase64',      inputs: { image: panelB64 } },
    '2':  { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'dreamshaper_8.safetensors' } },
    '3':  { class_type: 'CLIPTextEncode',        inputs: { text: prompt, clip: ['2', 1] } },
    '4':  { class_type: 'CLIPTextEncode',        inputs: { text: 'blurry, bad anatomy, watermark, worst quality, low quality', clip: ['2', 1] } },
    '5':  { class_type: 'VAEEncode',             inputs: { pixels: ['1', 0], vae: ['2', 2] } },
    '6':  { class_type: 'LoadImageBase64',        inputs: { image: poseB64 } },
    '7':  { class_type: 'ControlNetLoader',      inputs: { control_net_name: 'control_v11p_sd15_openpose.pth' } },
    '8':  { class_type: 'ControlNetApply',       inputs: { conditioning: ['3', 0], control_net: ['7', 0], image: ['6', 0], strength: 0.8 } },
    '9':  { class_type: 'KSampler',              inputs: { model: ['2', 0], positive: ['8', 0], negative: ['4', 0], latent_image: ['5', 0], seed, steps: 20, cfg: 7, sampler_name: 'euler_ancestral', scheduler: 'karras', denoise: 0.75 } },
    '10': { class_type: 'VAEDecode',             inputs: { samples: ['9', 0], vae: ['2', 2] } },
    '11': { class_type: 'SaveImage',             inputs: { filename_prefix: 'imagginary_pose', images: ['10', 0] } },
  };
}

// ── Main Service ─────────────────────────────────────────────────────────────

class PoseEngineService {
  private comfyBaseUrl: string | null = null;

  private async getComfyBaseUrl(): Promise<string> {
    if (this.comfyBaseUrl) return this.comfyBaseUrl;
    if (window.electronAPI?.getComfyUIProxyPort) {
      const port = await window.electronAPI!.getComfyUIProxyPort();
      if (port) {
        this.comfyBaseUrl = `http://127.0.0.1:${port}`;
        return this.comfyBaseUrl;
      }
    }
    return getComfyUIUrl();
  }

  /**
   * Generate a posed panel image via DreamShaper 8 + ControlNet OpenPose.
   * Returns a still image that replaces the panel's generatedImageData.
   */
  async generatePoseAnimation(params: PoseGenerationParams): Promise<PoseGenerationResult> {
    const { imageData, description, poseTemplateIds, onProgress } = params;
    const progress = (pct: number, msg: string) => onProgress?.(pct, msg);

    progress(5, 'Checking ControlNet model…');
    const { installed } = await window.electronAPI!.checkControlnetOpenpose();
    if (!installed) {
      throw new Error('CONTROLNET_NOT_INSTALLED');
    }

    // Resolve templates
    const selectedIds = poseTemplateIds.length > 0
      ? poseTemplateIds
      : matchPoseTemplates(description).map((t) => t.id);

    if (selectedIds.length === 0) {
      throw new Error('No matching pose templates found. Try describing the pose differently.');
    }

    progress(10, 'Rendering pose image…');

    // Use the first selected template's keyframe for the ControlNet pose image
    const firstTemplate = POSE_VOCABULARY.find((p) => p.id === selectedIds[0]);
    if (!firstTemplate) throw new Error('Pose template not found.');

    const poseImageDataUrl = renderPoseToOpenposePNG(firstTemplate.keyframe, 512, 512);

    // Build prompt
    const templateNames = selectedIds
      .map((id) => POSE_VOCABULARY.find((p) => p.id === id)?.name ?? '')
      .filter(Boolean)
      .join(', ');
    const prompt = [description, templateNames, 'cinematic storyboard, film style']
      .filter(Boolean)
      .join(', ');

    progress(20, 'Building ComfyUI workflow…');
    const workflow = buildPoseControlNetWorkflow(imageData, poseImageDataUrl, prompt);

    progress(25, 'Sending to ComfyUI…');
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
    progress(30, 'Pose generation queued…');

    const imageResult = await this.pollForImage(prompt_id, baseUrl, progress);
    progress(100, 'Pose complete');
    return { imageData: imageResult };
  }

  /** Poll /history until SaveImage output is ready, return as base64 PNG data URL. */
  private async pollForImage(
    promptId: string,
    baseUrl: string,
    onProgress: (pct: number, msg: string) => void,
  ): Promise<string> {
    const POLL_MS = 2000;
    const MAX_WAIT = 3 * 60 * 1000;
    const start = Date.now();
    let pct = 30;

    while (Date.now() - start < MAX_WAIT) {
      await new Promise((r) => setTimeout(r, POLL_MS));

      const histRes = await fetch(`${baseUrl}/history/${promptId}`);
      if (!histRes.ok) continue;

      const hist = await histRes.json() as Record<string, {
        outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
      }>;

      const entry = hist[promptId];
      if (!entry?.outputs) {
        pct = Math.min(pct + 4, 90);
        onProgress(pct, 'Rendering posed panel…');
        continue;
      }

      // Node '11' is SaveImage
      const imageOutput = entry.outputs['11']?.images?.[0];
      if (!imageOutput) throw new Error('ComfyUI returned no image output.');

      onProgress(93, 'Downloading result…');
      const { filename, subfolder, type } = imageOutput;
      const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;

      const imgRes = await fetch(viewUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.statusText}`);

      const blob = await imgRes.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read image blob'));
        reader.readAsDataURL(blob);
      });
    }

    throw new Error('Pose generation timed out after 3 minutes.');
  }
}

export const poseEngineService = new PoseEngineService();
