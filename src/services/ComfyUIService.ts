import { StructuredPrompt, StyleProfile } from '../types';
import { AspectRatio } from '../data/AspectRatios';
import { characterLibraryService } from './CharacterLibraryService';
import { settingsService } from './SettingsService';
import { telemetryService } from './TelemetryService';
import { licenseService, CREDIT_COSTS } from './LicenseService';
import { getComfyUIUrl } from '../config/services';

// In packaged Electron the renderer runs from file:// (null origin) and ComfyUI rejects
// those requests with 403. The main process runs a transparent local HTTP proxy that
// injects the correct Origin header. We resolve the proxy port once via IPC and cache it.
let resolvedBaseUrl: string | null = null;

async function getComfyBaseUrl(): Promise<string> {
  if (resolvedBaseUrl) return resolvedBaseUrl;
  if ((window as any).electronAPI?.getComfyUIProxyPort) {
    try {
      const port = await (window as any).electronAPI.getComfyUIProxyPort();
      if (port) {
        resolvedBaseUrl = `http://127.0.0.1:${port}`;
        return resolvedBaseUrl;
      }
    } catch { /* fall through to direct URL */ }
  }
  // Direct dev-mode / custom URL — read from settings, do not cache
  return getComfyUIUrl();
}

const STYLE_SUFFIX_BW =
  'storyboard art, ink sketch, black and white, cinematic composition, professional storyboard, bold lines, high contrast, film storyboard panel';

const STYLE_SUFFIX_COLOR =
  'cinematic color grading, professional storyboard art, highly detailed, cinematic composition, film storyboard panel';

const COLOR_KEYWORDS = /\b(neon|vibrant|golden|orange|blue|purple|pink|colorful|colour|color|warm tones|cool tones|warm light|cool light|teal|amber|red|green|yellow|cyan|magenta)\b/i;
// Action/violence keywords — additionalDetails containing these get boosted weight in the prompt
const ACTION_KEYWORDS = /stab|knife|gun|shoot|fight|punch|blood|attack|chase|struggle|weapon|kill|murder|strangle|explosion|wound|threat/i;

// SDXL model detection — used for resolution, sampler, and CFG settings
const SDXL_MODEL = /realvisxl|xl|sdxl/i;

function getNegativePrompt(checkpoint: string): string {
  if (/realvisxl|absolutereality/i.test(checkpoint)) {
    return 'blurry, low quality, watermark, deformed, extra limbs, text, cartoon, anime, painting';
  }
  return 'blurry, low quality, watermark, deformed, extra limbs, text, photorealistic, 3d render';
}

const CHARACTER_NEGATIVE_PROMPT =
  'background, environment, scenery, multiple characters, side view, back view, occluded, cropped, partial, blurry, low quality, watermark, text';

// ── Inpainting tuning — adjust here if quality needs improvement ──────────────
const INPAINT_STEPS = 28;           // Higher than panel gen for better blending
const INPAINT_DENOISE = 0.85;       // High enough to regenerate large regions cleanly
const INPAINT_MASK_GROW = 6;        // Pixels to expand mask for softer edges
const INPAINT_NEGATIVE_SUFFIX =
  ', seam, border, edge artifact, blurry transition, mismatched lighting, inconsistent style';

function getStyleSuffix(prompt: StructuredPrompt): string {
  const searchText = [
    prompt.subject,
    prompt.background,
    prompt.mood,
    prompt.lighting,
    prompt.additionalDetails ?? '',
  ].join(' ');

  return COLOR_KEYWORDS.test(searchText) ? STYLE_SUFFIX_COLOR : STYLE_SUFFIX_BW;
}

export interface ComfyUIStatus {
  connected: boolean;
  availableModels: string[];
  queueSize: number;
}

interface PromptResponse {
  prompt_id: string;
  number: number;
}

interface HistoryOutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

interface HistoryEntry {
  outputs: Record<string, {
    images?: HistoryOutputFile[];
    gifs?: HistoryOutputFile[];   // VHS_VideoCombine uses this key
  }>;
  status: { completed: boolean; status_str: string };
}

export class ComfyUIService {
  private defaultCheckpoint: string | null = null;
  private loraCache: string[] | null = null;
  private clientId: string;

  constructor() {
    this.clientId = `imagginary-${Math.random().toString(36).slice(2, 10)}`;
  }

  async checkConnection(): Promise<ComfyUIStatus> {
    // In packaged Electron, renderer fetch() is blocked by CSP from file:// origin.
    // Delegate the liveness check to the main process IPC handler.
    if ((window as any).electronAPI?.checkComfyUI) {
      try {
        const result = await (window as any).electronAPI.checkComfyUI();
        if (!result.connected) return { connected: false, availableModels: [], queueSize: 0 };
        const models = await this.getAvailableCheckpoints();
        return { connected: true, availableModels: models, queueSize: 0 };
      } catch {
        return { connected: false, availableModels: [], queueSize: 0 };
      }
    }

    // Fallback: direct fetch for browser dev mode (no Electron)
    try {
      const res = await fetch(`${await getComfyBaseUrl()}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { connected: false, availableModels: [], queueSize: 0 };
      const models = await this.getAvailableCheckpoints();
      return { connected: true, availableModels: models, queueSize: 0 };
    } catch {
      return { connected: false, availableModels: [], queueSize: 0 };
    }
  }

  async getAvailableCheckpoints(): Promise<string[]> {
    try {
      const response = await fetch(`${await getComfyBaseUrl()}/object_info/CheckpointLoaderSimple`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [];

      const data = await response.json() as {
        CheckpointLoaderSimple?: {
          input?: { required?: { ckpt_name?: [string[]] } };
        };
      };
      const checkpoints = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];

      if (checkpoints.length > 0) {
        const settings = settingsService.get();
        const userChoice = settings.activeCheckpoint
          ? checkpoints.find((c) => c === settings.activeCheckpoint) ?? null
          : null;
        // Re-evaluate whenever user has a preference, otherwise cache after first pick
        if (!this.defaultCheckpoint || userChoice) {
          const preferred =
            userChoice ??
            (licenseService.isPro() ? checkpoints.find((c) => /realvisxl/i.test(c)) : undefined) ??
            (licenseService.isPro() ? checkpoints.find((c) => /absolutereality/i.test(c)) : undefined) ??
            checkpoints.find((c) => /dreamshaper/i.test(c)) ??
            checkpoints.find((c) => /v1-5|stable-diffusion|sd15|realism|artistic/i.test(c));
          this.defaultCheckpoint = preferred ?? checkpoints[0];
        }
      }

      return checkpoints;
    } catch {
      return [];
    }
  }

  async getAvailableLoras(): Promise<string[]> {
    if (this.loraCache) return this.loraCache;
    try {
      const res = await fetch(`${await getComfyBaseUrl()}/object_info/LoraLoader`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) { this.loraCache = []; return []; }
      const data = await res.json() as {
        LoraLoader?: { input?: { required?: { lora_name?: [string[]] } } };
      };
      this.loraCache = data.LoraLoader?.input?.required?.lora_name?.[0] ?? [];
      return this.loraCache;
    } catch {
      this.loraCache = [];
      return [];
    }
  }

  /** Resolve a vault loraName (no extension) to the actual filename in ComfyUI.
   *  Returns null and logs a warning if the LoRA isn't installed — never throws. */
  private async resolveLoraName(loraName: string): Promise<string | null> {
    const loras = await this.getAvailableLoras();
    if (loras.includes(loraName)) return loraName;
    const match = loras.find((l) => {
      const base = l.replace(/\.[^.]+$/, ''); // strip extension
      return base === loraName || base.toLowerCase() === loraName.toLowerCase();
    });
    if (match) return match;
    console.warn(`[StyleVault] LoRA '${loraName}' not found — generating without style LoRA`);
    return null;
  }

  buildWorkflow(
    prompt: StructuredPrompt,
    aspectRatio: AspectRatio,
    characterDescription: string | null = null,
    seedOverride?: number,
    opts?: { promptSuffix?: string; negativePromptSuffix?: string; loraName?: string | null },
    referenceImageFilename: string | null = null,
    hasIPAdapter: boolean = false
  ): object {
    const checkpoint = this.defaultCheckpoint ?? 'v1-5-pruned-emaonly.ckpt';
    const checkpointNode = '1';
    const seed = seedOverride ?? Math.floor(Math.random() * 2 ** 31);
    const positivePrompt = this.buildPositivePrompt(prompt, characterDescription, opts?.promptSuffix);

    // Build negative prompt: base (model-aware) + style-specific terms
    const styleNegative = opts?.negativePromptSuffix ?? '';
    const fullNegative = [getNegativePrompt(checkpoint), styleNegative]
      .filter((s) => s.trim().length > 0)
      .join(', ');

    const lora = opts?.loraName ?? null;

    // SDXL detection — adjusts sampler settings and negative prompt
    const isSDXL     = SDXL_MODEL.test(checkpoint);
    const kSteps     = isSDXL ? 25 : 20;
    const kCfg       = isSDXL ? 5  : 7;
    const kSampler   = isSDXL ? 'dpmpp_2m' : 'euler';
    const kScheduler = isSDXL ? 'karras'   : 'normal';

    // When a LoRA is active: insert node '8' (LoraLoader) between checkpoint and text/sampler.
    // Node '2'/'3' CLIP references and node '5' model reference are redirected through the LoRA.
    const clipSource  = lora ? ['8', 1] : [checkpointNode, 1];
    const modelSource = lora ? ['8', 0] : [checkpointNode, 0];

    const workflow: Record<string, object> = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: checkpoint },
      },
      ...(lora ? {
        '8': {
          class_type: 'LoraLoader',
          inputs: {
            lora_name: lora,
            strength_model: 1.0,
            strength_clip: 1.0,
            model: [checkpointNode, 0],
            clip: [checkpointNode, 1],
          },
        },
      } : {}),
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: positivePrompt, clip: clipSource },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: fullNegative, clip: clipSource },
      },
      '4': {
        // Dimensions from AspectRatios.ts — all values guaranteed divisible by 8 (VAE tile factor).
        class_type: 'EmptyLatentImage',
        inputs: { width: aspectRatio.width, height: aspectRatio.height, batch_size: 1 },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: kSteps,
          cfg: kCfg,
          sampler_name: kSampler,
          scheduler: kScheduler,
          denoise: 1.0,
          add_noise: 'enable',
          model: modelSource,
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
      },
      '6': {
        class_type: 'VAEDecode',
        inputs: { samples: ['5', 0], vae: [checkpointNode, 2] },
      },
      '7': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'imagginary_panel', images: ['6', 0] },
      },
    };

    // Phase 9 — IPAdapter character reference (graceful fallback if node not installed)
    if (hasIPAdapter && referenceImageFilename) {
      workflow['10'] = {
        class_type: 'IPAdapterUnifiedLoader',
        inputs: {
          model: [checkpointNode, 0],
          preset: 'PLUS (high strength)',
        },
      };
      workflow['11'] = {
        class_type: 'IPAdapterAdvanced',
        inputs: {
          model: [checkpointNode, 0],
          ipadapter: ['10', 0],
          image: ['12', 0],
          weight: 0.6,
          weight_type: 'linear',
          combine_embeds: 'concat',
          start_at: 0.0,
          end_at: 0.9,
          embeds_scaling: 'V only',
        },
      };
      workflow['12'] = {
        class_type: 'LoadImage',
        inputs: { image: referenceImageFilename },
      };
      // Re-route KSampler to use IPAdapter output instead of raw model
      (workflow['5'] as { inputs: Record<string, unknown> }).inputs.model = ['11', 0];
    }

    return workflow;
  }

  /** Workflow for clean character portrait — square, white bg, front-facing */
  buildCharacterWorkflow(description: string, seedOverride?: number): object {
    const checkpoint = this.defaultCheckpoint ?? 'v1-5-pruned-emaonly.ckpt';
    const seed = seedOverride ?? Math.floor(Math.random() * 2 ** 31);
    const isSDXL     = SDXL_MODEL.test(checkpoint);
    const kSteps     = isSDXL ? 25 : 20;
    const kCfg       = isSDXL ? 5  : 7;
    const kSampler   = isSDXL ? 'dpmpp_2m' : 'euler';
    const kScheduler = isSDXL ? 'karras'   : 'normal';
    const imgSize    = isSDXL ? 1024 : 512;

    const positive = `(${description}:1.4), full body portrait, front facing, ` +
      `neutral white background, character reference sheet, clear flat lighting, ` +
      `no background shadows, storyboard character design, clean linework`;

    return {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: CHARACTER_NEGATIVE_PROMPT, clip: ['1', 1] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: imgSize, height: imgSize, batch_size: 1 } },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed, steps: kSteps, cfg: kCfg,
          sampler_name: kSampler, scheduler: kScheduler, denoise: 1.0,
          model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        },
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'imagginary_char', images: ['6', 0] } },
    };
  }

  buildPositivePrompt(
    prompt: StructuredPrompt,
    characterDescription: string | null = null,
    stylePromptSuffix?: string
  ): string {
    // Use vault-supplied suffix when available; fall back to keyword-detection heuristic
    const styleSuffix = stylePromptSuffix ?? getStyleSuffix(prompt);

    // additionalDetails — boost weight when it contains action or violence keywords
    const detailsEntry = prompt.additionalDetails
      ? ACTION_KEYWORDS.test(prompt.additionalDetails)
        ? `(${prompt.additionalDetails}:1.2)`
        : prompt.additionalDetails
      : null;

    const rest = [
      prompt.shotType,
      detailsEntry,
      prompt.background,
      `${prompt.lighting} lighting`,
      `${prompt.angle} angle`,
      prompt.mood,
      prompt.timeOfDay !== 'day' ? prompt.timeOfDay : null,
      styleSuffix,
    ].filter(Boolean).join(', ');

    // When a character is selected, prepend their description with strong weighting
    // so the model anchors appearance through the prompt rather than IPAdapter.
    if (characterDescription) {
      return `(solo, ${characterDescription}:1.2), (${prompt.subject}:1.4), ${rest}`;
    }

    // Subject gets strong weighting so the model prioritises it over background
    return `(${prompt.subject}:1.4), ${rest}`;
  }

  async generateImage(
    prompt: StructuredPrompt,
    aspectRatio: AspectRatio,
    onProgress?: (progress: number, message: string) => void,
    characterIds: string[] = [],
    style?: StyleProfile,
    shotAngle: string = ''
  ): Promise<string> {
    // Pro/Studio: automatically route to FLUX.1 Schnell via Fal.ai when key + credits available.
    // No manual toggle — cloud routing is transparent and always falls back to local on failure.
    if (licenseService.isPro()) {
      const falApiKey = settingsService.getKey('falApiKey') || (process.env.FAL_API_KEY ?? '');
      if (falApiKey && licenseService.hasCredits(CREDIT_COSTS.panelCloud)) {
        const result = await this.generateWithFluxSchnell(prompt, aspectRatio, falApiKey, onProgress);
        if (result) {
          licenseService.spendCredits(CREDIT_COSTS.panelCloud);
          telemetryService.track('panel_generated_cloud', { provider: 'flux_schnell' });
          return result;
        }
        // Flux failed — fall through to local silently
        onProgress?.(5, 'Cloud unavailable — using local…');
      }
    }
    return this.generateImageLocal(prompt, aspectRatio, onProgress, characterIds, style, shotAngle);
  }

  private async generateImageLocal(
    prompt: StructuredPrompt,
    aspectRatio: AspectRatio,
    onProgress?: (progress: number, message: string) => void,
    characterIds: string[] = [],
    style?: StyleProfile,
    shotAngle: string = ''
  ): Promise<string> {
    if (!this.defaultCheckpoint) {
      await this.getAvailableCheckpoints();
    }

    // Resolve character description for prompt injection (first character wins)
    let characterDescription: string | null = null;
    if (characterIds.length > 0) {
      for (const cid of characterIds) {
        const character = characterLibraryService.get(cid);
        if (character?.description) {
          characterDescription = character.description;
          break;
        }
      }
    }

    // Phase 9 — IPAdapter reference image selection
    // Pick the best angle reference from the first character that has multiview data.
    // Upload it to ComfyUI input so it's available if IPAdapter nodes are present.
    let referenceImageFilename: string | null = null;

    if (characterIds.length > 0 && shotAngle) {
      for (const charId of characterIds) {
        const ref = characterLibraryService.getBestAngleReference(charId, shotAngle);
        if (ref) {
          try {
            const base64 = ref.replace(/^data:image\/[^;]+;base64,/, '');
            const filename = `ipadapter_ref_${charId}_${Date.now()}.png`;
            await this.uploadImageToComfyUI(base64, filename);
            referenceImageFilename = filename;
            onProgress?.(5, 'Reference image loaded…');
          } catch {
            // Non-fatal — fall back to prompt-only generation
          }
          break;
        }
      }
    }

    // Only wire IPAdapter if the node is installed in this user's ComfyUI
    const hasIPAdapter = referenceImageFilename
      ? await this.isNodeAvailable('IPAdapterUnifiedLoader')
      : false;

    if (referenceImageFilename && !hasIPAdapter) {
      console.log('[IPAdapter] Node not available — using prompt-only generation');
    }

    // If IPAdapter not installed locally but Fal.ai key exists → use cloud (if credits remain).
    // BYOK key takes priority over the shared key baked in at build time.
    if (!hasIPAdapter && referenceImageFilename) {
      const falApiKey = settingsService.getKey('falApiKey') || (process.env.FAL_API_KEY ?? '');
      if (falApiKey && licenseService.hasCredits(CREDIT_COSTS.characterPanel)) {
        try {
          const positivePrompt = this.buildPositivePrompt(prompt, characterDescription, style?.promptSuffix);
          const falResult = await this.runCloudIPAdapter(referenceImageFilename, positivePrompt, falApiKey);
          if (falResult) {
            licenseService.spendCredits(CREDIT_COSTS.characterPanel);
            return falResult;
          }
        } catch {
          // Fall through to local generation without IPAdapter
        }
      }
    }

    // Resolve LoRA filename — silently skips if not installed (expected for Pro placeholders)
    let resolvedLora: string | null = null;
    if (style?.loraName) {
      resolvedLora = await this.resolveLoraName(style.loraName);
    }

    const workflow = this.buildWorkflow(prompt, aspectRatio, characterDescription, undefined, {
      promptSuffix:         style?.promptSuffix,
      negativePromptSuffix: style?.negativePrompt,
      loraName:             resolvedLora,
    }, referenceImageFilename, hasIPAdapter);

    onProgress?.(5, 'Sending prompt to ComfyUI...');

    const submitRes = await fetch(`${await getComfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId,
      }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`ComfyUI prompt submission failed: ${submitRes.status} — ${errText}`);
    }

    const submitData = await submitRes.json() as PromptResponse;
    const promptId = submitData.prompt_id;

    onProgress?.(10, 'Queued — waiting for generation...');

    return this.pollForCompletion(promptId, onProgress);
  }

  private async generateWithFluxSchnell(
    prompt: StructuredPrompt,
    aspectRatio: AspectRatio,
    falApiKey: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string | null> {
    try {
      onProgress?.(5, 'Generating with FLUX.1 Schnell…');

      const positivePrompt = this.buildPositivePrompt(prompt);

      const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: positivePrompt,
          image_size: { width: aspectRatio.width, height: aspectRatio.height },
          num_inference_steps: 4,
          num_images: 1,
          enable_safety_checker: false,
        }),
      });

      if (!res.ok) return null;
      onProgress?.(60, 'Processing…');

      const data = await res.json() as { images?: { url: string }[] };
      const imageUrl = data.images?.[0]?.url;
      if (!imageUrl) return null;

      const imgRes = await fetch(imageUrl);
      const blob = await imgRes.blob();
      const base64 = await blobToBase64(blob);
      onProgress?.(100, 'Done');
      return base64;
    } catch {
      return null;
    }
  }

  /** Generate a clean front-facing character portrait for the identity system */
  async generateCharacterReference(
    description: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string> {
    if (!this.defaultCheckpoint) {
      await this.getAvailableCheckpoints();
    }

    const workflow = this.buildCharacterWorkflow(description);
    onProgress?.(5, 'Generating character reference...');

    const submitRes = await fetch(`${await getComfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`Character reference generation failed: ${submitRes.status} — ${errText}`);
    }

    const { prompt_id } = await submitRes.json() as PromptResponse;
    onProgress?.(10, 'Queued...');
    return this.pollForCompletion(prompt_id, onProgress);
  }

  private async getUploadedImageData(filename: string): Promise<string | null> {
    try {
      const url = `${await getComfyBaseUrl()}/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await blobToBase64(blob);
    } catch {
      return null;
    }
  }

  private async runCloudIPAdapter(
    referenceFilename: string,
    prompt: string,
    falApiKey: string
  ): Promise<string | null> {
    const refData = await this.getUploadedImageData(referenceFilename);
    if (!refData) return null;

    const res = await fetch('https://fal.run/fal-ai/ipadapter-faceid', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        face_image_url: refData,
        scale: 0.6,
        num_inference_steps: 20,
      }),
    });

    if (!res.ok) return null;
    const result = await res.json() as { images?: { url: string }[] };
    return result.images?.[0]?.url ?? null;
  }

  private async uploadImageToComfyUI(base64Data: string, filename: string): Promise<string> {
    const base64 = base64Data.replace(/^data:image\/[^;]+;base64,/, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });

    const formData = new FormData();
    formData.append('image', blob, filename);
    formData.append('overwrite', 'true');

    const res = await fetch(`${await getComfyBaseUrl()}/upload/image`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error(`Failed to upload image to ComfyUI: ${res.status}`);
    const data = await res.json() as { name: string };
    return data.name;
  }

  buildInpaintWorkflow(
    imageName: string,
    maskName: string,
    editDescription: string,
    characterDescription: string | null = null,
    seedOverride?: number
  ): object {
    const checkpoint = this.defaultCheckpoint ?? 'v1-5-pruned-emaonly.ckpt';
    const seed = seedOverride ?? Math.floor(Math.random() * 2 ** 31);
    const isSDXL     = SDXL_MODEL.test(checkpoint);
    const kCfg       = isSDXL ? 5  : 7;
    const kSampler   = isSDXL ? 'dpmpp_2m' : 'euler';
    const kScheduler = isSDXL ? 'karras'   : 'normal';
    const positive = characterDescription
      ? `(solo, ${characterDescription}:1.2), (${editDescription}:1.4), ${STYLE_SUFFIX_BW}`
      : `(${editDescription}:1.4), ${STYLE_SUFFIX_BW}`;

    return {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: getNegativePrompt(checkpoint) + INPAINT_NEGATIVE_SUFFIX, clip: ['1', 1] } },
      '4': { class_type: 'LoadImage', inputs: { image: imageName } },
      '5': { class_type: 'LoadImage', inputs: { image: maskName } },
      '6': { class_type: 'ImageToMask', inputs: { image: ['5', 0], channel: 'red' } },
      '7': {
        class_type: 'VAEEncodeForInpaint',
        inputs: { pixels: ['4', 0], vae: ['1', 2], mask: ['6', 0], grow_mask_by: INPAINT_MASK_GROW },
      },
      '8': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: INPAINT_STEPS,
          cfg: kCfg,
          sampler_name: kSampler,
          scheduler: kScheduler,
          denoise: INPAINT_DENOISE,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['7', 0],
        },
      },
      '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
      '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'imagginary_inpaint', images: ['9', 0] } },
    };
  }

  async inpaintPanel(
    imageData: string,
    maskData: string,
    editDescription: string,
    onProgress?: (progress: number, message: string) => void,
    characterIds: string[] = []
  ): Promise<string> {
    // Pro tier — use FLUX.1 Fill via Fal.ai if key is available and credits remain.
    // BYOK key takes priority over the shared key baked in at build time.
    if (licenseService.isPro()) {
      const falApiKey = settingsService.getKey('falApiKey') || (process.env.FAL_API_KEY ?? '');
      if (falApiKey) {
        if (!licenseService.hasCredits(CREDIT_COSTS.inpaint)) {
          onProgress?.(0, 'Insufficient credits — using local generation');
        } else {
          const rawImage = imageData.replace(/^data:image\/[^;]+;base64,/, '');
          const rawMask  = maskData.replace(/^data:image\/[^;]+;base64,/, '');
          const result = await this.inpaintWithFluxFill(rawImage, rawMask, editDescription, falApiKey, onProgress);
          if (result) {
            licenseService.spendCredits(CREDIT_COSTS.inpaint);
            return result;
          }
          // null means Fal.ai failed — fall through to local DreamShaper
          onProgress?.(0, 'Cloud inpainting failed — using local model…');
        }
      }
    }

    // Community fallback — DreamShaper with tuning improvements
    if (!this.defaultCheckpoint) {
      await this.getAvailableCheckpoints();
    }

    let characterDescription: string | null = null;
    if (characterIds.length > 0) {
      for (const cid of characterIds) {
        const character = characterLibraryService.get(cid);
        if (character?.description) {
          characterDescription = character.description;
          break;
        }
      }
    }

    onProgress?.(5, 'Uploading images to ComfyUI...');
    const ts = Date.now();
    const [imageName, maskName] = await Promise.all([
      this.uploadImageToComfyUI(imageData, `imagginary_inpaint_src_${ts}.png`),
      this.uploadImageToComfyUI(maskData, `imagginary_inpaint_mask_${ts}.png`),
    ]);

    const workflow = this.buildInpaintWorkflow(imageName, maskName, editDescription, characterDescription);

    onProgress?.(10, 'Sending inpaint job to ComfyUI...');

    const submitRes = await fetch(`${await getComfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`ComfyUI inpaint submission failed: ${submitRes.status} — ${errText}`);
    }

    const { prompt_id } = await submitRes.json() as PromptResponse;
    onProgress?.(15, 'Queued — waiting for inpainting...');
    return this.pollForCompletion(prompt_id, onProgress);
  }

  private async inpaintWithFluxFill(
    imageBase64: string,
    maskBase64: string,
    prompt: string,
    falApiKey: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string | null> {
    try {
      onProgress?.(10, 'Sending to FLUX.1 Fill…');

      const res = await fetch('https://fal.run/fal-ai/flux/dev/image-to-image/inpainting', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          image_url: `data:image/png;base64,${imageBase64}`,
          mask_url:  `data:image/png;base64,${maskBase64}`,
          num_inference_steps: INPAINT_STEPS,
          strength: INPAINT_DENOISE,
          guidance_scale: 3.5,
          output_format: 'png',
        }),
      });

      if (!res.ok) {
        console.warn('[FluxFill] API error:', res.status, '— falling back to local');
        return null; // triggers community fallback
      }

      onProgress?.(80, 'Processing result…');
      const data = await res.json() as { images?: { url: string }[] };
      const imageUrl = data.images?.[0]?.url;
      if (!imageUrl) return null;

      // Download the result image
      const imgRes = await fetch(imageUrl);
      const blob = await imgRes.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });

      onProgress?.(100, 'Done');
      telemetryService.track('inpaint_flux_fill');
      return `data:image/png;base64,${base64}`;

    } catch (err) {
      console.warn('[FluxFill] Error — falling back to local:', err);
      return null; // triggers community fallback
    }
  }

  // ── Motion Layer (Phase 6 — Wan 2.2) ──────────────────────────────────────

  private async isNodeAvailable(nodeType: string): Promise<boolean> {
    try {
      const res = await fetch(`${await getComfyBaseUrl()}/object_info/${nodeType}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      // ComfyUI returns HTTP 200 with {} when the node is not installed — check for the key.
      const data = await res.json() as Record<string, unknown>;
      return nodeType in data;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 6 — The Motion Layer
  // Status: Complete. Tested on NVIDIA RTX 4090 (RunPod).
  // Apple Silicon: requires 64GB+ or PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0
  // Community users without hardware see upgrade prompt automatically.
  // ─────────────────────────────────────────────────────────────────────────────

  /** Discover installed Wan model files by querying ComfyUI's node schemas. */
  private async discoverWanModels(): Promise<
    | { available: true; warning?: 'low_memory'; diffusionModel: string; vaeModel: string; t5Model: string }
    | { available: false; reason: 'no_compatible_model' }
  > {
    const [diffRes, vaeRes, t5Res] = await Promise.all([
      fetch(`${await getComfyBaseUrl()}/object_info/WanVideoModelLoader`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${await getComfyBaseUrl()}/object_info/WanVideoVAELoader`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${await getComfyBaseUrl()}/object_info/LoadWanVideoT5TextEncoder`, { signal: AbortSignal.timeout(5000) }),
    ]);

    type ObjInfo = Record<string, { input?: { required?: Record<string, [unknown[]]> } }>;
    const [diffData, vaeData, t5Data] = await Promise.all([
      diffRes.json() as Promise<ObjInfo>,
      vaeRes.json() as Promise<ObjInfo>,
      t5Res.json() as Promise<ObjInfo>,
    ]);

    const diffusionModels = (diffData.WanVideoModelLoader?.input?.required?.model?.[0] ?? []) as string[];
    const vaeModels = (vaeData.WanVideoVAELoader?.input?.required?.model_name?.[0] ?? []) as string[];
    const t5Models = (t5Data.LoadWanVideoT5TextEncoder?.input?.required?.model_name?.[0] ?? []) as string[];

    // Prefer smallest viable I2V model — fp8 480P first, then any Wan I2V, then first available
    const diffusionModel =
      diffusionModels.find((m) => /wan.*i2v.*480p.*fp8/i.test(m)) ??
      diffusionModels.find((m) => /wan.*i2v.*fp8/i.test(m)) ??
      diffusionModels.find((m) => /wan2.*i2v/i.test(m)) ??
      diffusionModels[0];

    if (!diffusionModel || vaeModels.length === 0 || t5Models.length === 0) {
      return { available: false, reason: 'no_compatible_model' };
    }

    // Check system RAM — warn if < 48 GB (32 GB Apple Silicon will likely OOM on BF16 models)
    let warning: 'low_memory' | undefined;
    try {
      const statsRes = await fetch(`${await getComfyBaseUrl()}/system_stats`, { signal: AbortSignal.timeout(3000) });
      if (statsRes.ok) {
        const stats = await statsRes.json() as { system?: { ram_total?: number } };
        const ramGB = (stats.system?.ram_total ?? 0) / (1024 ** 3);
        if (ramGB > 0 && ramGB < 48) warning = 'low_memory';
      }
    } catch {
      // Can't determine — don't warn
    }

    return { available: true, warning, diffusionModel, vaeModel: vaeModels[0], t5Model: t5Models[0] };
  }

  /**
   * Check whether a compatible Wan I2V model is installed and ready.
   * Returns quickly — safe to call on every animate button click.
   */
  async checkWanModelAvailability(): Promise<{ available: boolean; warning?: string; reason?: string }> {
    try {
      const nodeAvailable = await this.isNodeAvailable('WanVideoModelLoader');
      if (!nodeAvailable) return { available: false, reason: 'nodes_not_installed' };
      const result = await this.discoverWanModels();
      return result.available
        ? { available: true, warning: result.warning }
        : { available: false, reason: result.reason };
    } catch {
      return { available: false, reason: 'check_failed' };
    }
  }

  /**
   * Build the WanVideoWrapper I2V workflow.
   * Pipeline:
   *   WanVideoModelLoader → WanVideoVAELoader → LoadWanVideoT5TextEncoder
   *   → WanVideoTextEncode → LoadImage (uploaded) → WanVideoImageToVideoEncode
   *   → WanVideoSampler → WanVideoDecode → SaveAnimatedWEBP
   */
  buildAnimaticWorkflow(params: {
    imageName: string;
    motionPrompt: string;
    diffusionModel: string;
    vaeModel: string;
    t5Model: string;
    numFrames?: number;
    seed?: number;
  }): object {
    const {
      imageName,
      motionPrompt,
      diffusionModel,
      vaeModel,
      t5Model,
      numFrames = 25,   // 25 @ 24 fps ≈ 1 s — conservative default for 32GB Apple Silicon
      seed = Math.floor(Math.random() * 999999999),
    } = params;

    return {
      // 1 — load diffusion model
      // Using pre-quantized fp8 model (Wan2_1-I2V-14B-480P_fp8_e4m3fn) — quantization: disabled
      // because the weights are already fp8 on disk. offload_device = load to CPU first,
      // ComfyUI moves layers to MPS per-op.
      '1': {
        class_type: 'WanVideoModelLoader',
        inputs: {
          model: diffusionModel,
          base_precision: 'bf16',
          quantization: 'disabled',
          load_device: 'offload_device',
        },
      },
      // 2 — load VAE
      '2': {
        class_type: 'WanVideoVAELoader',
        inputs: { model_name: vaeModel, precision: 'bf16' },
      },
      // 3 — load T5 text encoder
      '3': {
        class_type: 'LoadWanVideoT5TextEncoder',
        inputs: { model_name: t5Model, precision: 'bf16' },
      },
      // 4 — encode motion prompts
      '4': {
        class_type: 'WanVideoTextEncode',
        inputs: {
          positive_prompt: motionPrompt,
          negative_prompt: 'static, no movement, frozen, blurry motion, artifacts, distorted, worst quality',
          t5: ['3', 0],
        },
      },
      // 5 — load uploaded source image
      '5': {
        class_type: 'LoadImage',
        inputs: { image: imageName },
      },
      // 6 — encode source image for I2V (tiled_vae reduces VAE encoder memory on Apple Silicon)
      '6': {
        class_type: 'WanVideoImageToVideoEncode',
        inputs: {
          width: 768,
          height: 432,
          num_frames: numFrames,
          noise_aug_strength: 0.0,
          start_latent_strength: 1.0,
          end_latent_strength: 1.0,
          force_offload: true,
          vae: ['2', 0],
          start_image: ['5', 0],
          tiled_vae: true,
        },
      },
      // 7 — sample
      // rope_function: 'comfy_chunked' avoids torch.view_as_complex(float64) — MPS only supports float32
      '7': {
        class_type: 'WanVideoSampler',
        inputs: {
          model: ['1', 0],
          image_embeds: ['6', 0],
          text_embeds: ['4', 0],
          steps: 20,
          cfg: 6.0,
          shift: 5.0,
          seed,
          force_offload: true,
          scheduler: 'unipc',
          riflex_freq_index: 0,
          rope_function: 'comfy_chunked',
        },
      },
      // 8 — decode latents to frames
      '8': {
        class_type: 'WanVideoDecode',
        inputs: {
          vae: ['2', 0],
          samples: ['7', 0],
          enable_vae_tiling: true,
          tile_x: 272,
          tile_y: 272,
          tile_stride_x: 144,
          tile_stride_y: 128,
        },
      },
      // 9 — save as animated WebP
      '9': {
        class_type: 'SaveAnimatedWEBP',
        inputs: {
          images: ['8', 0],
          filename_prefix: 'imagginary_motion',
          fps: 24,
          lossless: false,
          quality: 80,
          method: 'default',
        },
      },
    };
  }

  async animatePanelCloud(
    imageData: string,
    motionPrompt: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string | null> {
    const falApiKey = settingsService.getKey('falApiKey') || (process.env.FAL_API_KEY ?? '');
    if (!falApiKey) return null;
    if (!licenseService.hasCredits(CREDIT_COSTS.motionClip)) {
      onProgress?.(0, 'Insufficient credits for motion generation');
      return null;
    }

    try {
      onProgress?.(5, 'Sending to Kling via Fal.ai…');

      const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
      const imageUrl = `data:image/png;base64,${base64}`;

      const submitRes = await fetch('https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: motionPrompt,
          duration: '5',
          aspect_ratio: '16:9',
        }),
      });

      if (!submitRes.ok) {
        console.warn('[Kling] Submit failed:', submitRes.status);
        return null;
      }

      const job = await submitRes.json() as { request_id: string };
      const requestId = job.request_id;

      onProgress?.(15, 'Kling is generating motion…');

      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const pollRes = await fetch(
          `https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/${requestId}`,
          { headers: { 'Authorization': `Key ${falApiKey}` } }
        );
        if (!pollRes.ok) continue;
        const status = await pollRes.json() as { status?: string; video?: { url: string } };
        const pct = 15 + Math.min(i * 1.3, 75);
        onProgress?.(pct, `Generating motion… ${status.status ?? ''}`);

        if (status.status === 'COMPLETED') {
          onProgress?.(92, 'Downloading result…');
          const videoUrl = status.video?.url;
          if (!videoUrl) return null;

          const videoRes = await fetch(videoUrl);
          const blob = await videoRes.blob();
          const base64Result = await blobToBase64(blob);

          licenseService.spendCredits(CREDIT_COSTS.motionClip);
          telemetryService.track('motion_generated_cloud', { provider: 'kling' });
          onProgress?.(100, 'Done');
          return base64Result;
        }

        if (status.status === 'FAILED') {
          console.warn('[Kling] Generation failed');
          return null;
        }
      }
      return null;
    } catch (err) {
      console.warn('[Kling] Error:', err);
      return null;
    }
  }

  async animatePanel(
    imageData: string,
    motionPrompt: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string> {
    onProgress?.(3, 'Checking Wan 2.2 nodes...');

    const wanAvailable = await this.isNodeAvailable('WanVideoModelLoader');
    if (!wanAvailable) {
      throw new Error(
        'Wan 2.2 not installed in ComfyUI.\n' +
        'To install: follow the ComfyUI custom nodes setup guide in the project README.\n' +
        'Generation time: ~20–40 min on Apple Silicon (block swap enabled).'
      );
    }

    onProgress?.(5, 'Checking Wan 2.2 model files...');
    const models = await this.discoverWanModels();
    if (!models.available) {
      throw new Error('WAN_MODEL_UNAVAILABLE');
    }

    onProgress?.(8, 'Uploading source image to ComfyUI...');
    const imageName = await this.uploadImageToComfyUI(imageData, `imagginary_wan_src_${Date.now()}.png`);

    onProgress?.(10, 'Submitting workflow to ComfyUI...');
    const workflow = this.buildAnimaticWorkflow({ imageName, motionPrompt, ...models });

    const submitRes = await fetch(`${await getComfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`ComfyUI prompt submission failed: ${submitRes.status} — ${errText}`);
    }

    const { prompt_id } = await submitRes.json() as PromptResponse;
    onProgress?.(12, 'Queued — ~3–8 min on Apple Silicon · Faster in Pro via cloud...');
    return this.pollForVideoCompletion(prompt_id, onProgress);
  }

  private async pollForVideoCompletion(
    promptId: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string> {
    // Wan 2.2 with block swap on Apple Silicon can take 20–40 min — allow up to 60 minutes
    const maxAttempts = 3600;
    const pollInterval = 1000;
    let attempt = 0;

    while (attempt < maxAttempts) {
      await sleep(pollInterval);
      attempt++;

      try {
        const queueRes = await fetch(`${await getComfyBaseUrl()}/queue`);
        if (queueRes.ok) {
          const queueData = await queueRes.json() as {
            queue_running?: Array<[number, string]>;
            queue_pending?: Array<[number, string]>;
          };
          const running = queueData.queue_running ?? [];
          const pending = queueData.queue_pending ?? [];
          const isRunning = running.some((item) => item[1] === promptId);
          const pendingIdx = pending.findIndex((item) => item[1] === promptId);

          if (isRunning) {
            const progress = Math.min(12 + (attempt / maxAttempts) * 78, 90);
            onProgress?.(progress, '~3–8 min on Apple Silicon · Faster in Pro via cloud');
          } else if (pendingIdx >= 0) {
            onProgress?.(12, `Queue position ${pendingIdx + 1} — waiting...`);
          }
        }
      } catch {
        // Queue check failed; continue polling history
      }

      try {
        const histRes = await fetch(`${await getComfyBaseUrl()}/history/${promptId}`);
        if (!histRes.ok) continue;

        const histData = await histRes.json() as Record<string, HistoryEntry>;
        const entry = histData[promptId];

        if (!entry || !entry.status?.completed) continue;

        onProgress?.(92, 'Retrieving video...');

        for (const nodeOutput of Object.values(entry.outputs)) {
          // VHS_VideoCombine writes to 'gifs'; SaveAnimatedWEBP writes to 'images'
          const files = nodeOutput.gifs ?? nodeOutput.images;
          if (files && files.length > 0) {
            const file = files[0];
            const videoUrl =
              `${await getComfyBaseUrl()}/view?filename=${encodeURIComponent(file.filename)}` +
              `&subfolder=${encodeURIComponent(file.subfolder ?? '')}` +
              `&type=${file.type}`;
            const videoRes = await fetch(videoUrl);
            if (!videoRes.ok) throw new Error('Failed to fetch generated video from ComfyUI');

            const blob = await videoRes.blob();
            const base64 = await blobToBase64(blob);
            onProgress?.(100, 'Motion clip ready');
            return base64;
          }
        }

        throw new Error('Generation completed but no video found in output');
      } catch (err) {
        if (attempt >= maxAttempts - 1) throw err;
      }
    }

    throw new Error('Motion generation timed out after 60 minutes');
  }

  private async pollForCompletion(
    promptId: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string> {
    const maxAttempts = 120; // 2 minutes
    const pollInterval = 1000;
    let attempt = 0;

    while (attempt < maxAttempts) {
      await sleep(pollInterval);
      attempt++;

      // Check queue position first
      try {
        const queueRes = await fetch(`${await getComfyBaseUrl()}/queue`);
        if (queueRes.ok) {
          const queueData = await queueRes.json() as {
            queue_running?: Array<[number, string]>;
            queue_pending?: Array<[number, string]>;
          };
          const running = queueData.queue_running ?? [];
          const pending = queueData.queue_pending ?? [];

          const isRunning = running.some((item) => item[1] === promptId);
          const pendingIdx = pending.findIndex((item) => item[1] === promptId);

          if (isRunning) {
            const progress = Math.min(10 + (attempt / maxAttempts) * 75, 85);
            onProgress?.(progress, 'Generating...');
          } else if (pendingIdx >= 0) {
            onProgress?.(10, `Queue position: ${pendingIdx + 1}...`);
          }
        }
      } catch {
        // Queue check failed, continue polling history
      }

      // Check history
      try {
        const histRes = await fetch(`${await getComfyBaseUrl()}/history/${promptId}`);
        if (!histRes.ok) continue;

        const histData = await histRes.json() as Record<string, HistoryEntry>;
        const entry = histData[promptId];

        if (!entry) continue;
        if (!entry.status?.completed) continue;

        onProgress?.(90, 'Retrieving image...');

        // Find output images
        for (const nodeOutput of Object.values(entry.outputs)) {
          const images = nodeOutput.images;
          if (images && images.length > 0) {
            const img = images[0];
            const imageUrl = `${await getComfyBaseUrl()}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) throw new Error('Failed to fetch generated image');

            const blob = await imgRes.blob();
            const base64 = await blobToBase64(blob);
            onProgress?.(100, 'Complete');
            return base64;
          }
        }

        throw new Error('Generation completed but no image found in output');
      } catch (err) {
        if (attempt >= maxAttempts - 1) throw err;
      }
    }

    throw new Error('Generation timed out after 2 minutes');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const comfyUIService = new ComfyUIService();
