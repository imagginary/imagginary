/**
 * Phase 6C — MotionLibraryService
 *
 * Manages the motion clip library: searching, loading pose sequences,
 * applying clips to panels via ComfyUI ControlNet + Wan 2.2, and
 * extracting pose from user-uploaded reference videos (Pro only).
 */

import { MotionClip } from '../types';
import { PoseKeyframe } from '../data/PoseVocabulary';
import { expandSequence, renderPoseToDataURL } from './PoseEngineService';
import { comfyUIService } from './ComfyUIService';
import { licenseService } from './LicenseService';
import { getOllamaUrl, getComfyUIUrl } from '../config/services';

// ── Starter library index (bundled — works without Pexels API key) ────────────

const STARTER_INDEX: Omit<MotionClip, 'thumbnail' | 'poseSequencePath'>[] = [
  { id: 'walk-cycle',        name: 'Walk Cycle',        description: 'Natural walking forward motion with arm swing',                     category: 'walks',        duration: 2.0, tags: ['walk','walking','forward','stride'],                confidence: 94, isStarter: true },
  { id: 'turn-reveal',       name: 'Turn Reveal',       description: 'Character turns from profile to face camera',                       category: 'turns',        duration: 1.5, tags: ['turn','reveal','rotate','cinematic'],              confidence: 91, isStarter: true },
  { id: 'wave-greeting',     name: 'Wave Greeting',     description: 'Friendly overhead wave with arm raised and hand sweeping',          category: 'gestures',     duration: 1.5, tags: ['wave','greeting','hello','friendly'],              confidence: 96, isStarter: true },
  { id: 'surprise-reaction', name: 'Surprise Reaction', description: 'Startled backward step, hands raised in shock',                    category: 'reactions',    duration: 1.0, tags: ['surprise','shock','startled','scared'],           confidence: 93, isStarter: true },
  { id: 'punch-combo',       name: 'Punch Combo',       description: 'Fighting stance to extended punch, returning to guard',             category: 'combat',       duration: 1.5, tags: ['punch','fight','combat','strike'],                confidence: 89, isStarter: true },
  { id: 'emotional-despair', name: 'Emotional Despair', description: 'Character slumps into despair, head bowing, shoulders dropping',   category: 'emotional',    duration: 2.0, tags: ['sad','despair','grief','emotional','sorrow'],     confidence: 92, isStarter: true },
  { id: 'hero-reveal',       name: 'Hero Reveal',       description: 'Dramatic silhouette to triumphant arms-raised victory pose',       category: 'cinematic',    duration: 2.0, tags: ['hero','triumph','victory','cinematic','dramatic'], confidence: 97, isStarter: true },
  { id: 'sprint-burst',      name: 'Sprint Burst',      description: 'Explosive sprint start, full running stride at speed',             category: 'running',      duration: 1.5, tags: ['run','sprint','fast','dash','athletic'],          confidence: 95, isStarter: true },
  { id: 'dance-step',        name: 'Dance Step',        description: 'Simple rhythmic dance move with hip sway and arm swing',           category: 'dance',        duration: 2.0, tags: ['dance','rhythm','party','groove','celebrate'],    confidence: 88, isStarter: true },
  { id: 'desk-work',         name: 'Desk Work',         description: 'Seated typing posture shifting to leaning forward in concentration',category: 'work',         duration: 2.5, tags: ['work','typing','office','desk','computer'],       confidence: 91, isStarter: true },
  { id: 'sitting-idle',      name: 'Sitting Idle',      description: 'Relaxed seated pose shifting weight between casual positions',     category: 'sitting',      duration: 3.0, tags: ['sit','idle','relax','casual','rest'],             confidence: 93, isStarter: true },
  { id: 'standing-idle',     name: 'Standing Idle',     description: 'Relaxed weight shift from neutral to contrapposto stance',         category: 'standing',     duration: 2.0, tags: ['stand','idle','neutral','wait','rest'],           confidence: 96, isStarter: true },
  { id: 'stand-to-sit',      name: 'Stand to Sit',      description: 'Character lowers from standing through crouching into seated position', category: 'transitions', duration: 2.0, tags: ['transition','sit down','lower','chair'],       confidence: 90, isStarter: true },
  { id: 'crowd-cheer',       name: 'Crowd Cheer',       description: 'Enthusiastic cheer with arms pumping up, celebration',            category: 'crowd',        duration: 1.5, tags: ['cheer','celebrate','crowd','victory','arms up'],  confidence: 87, isStarter: true },
  { id: 'reach-upward',      name: 'Reach Upward',      description: 'Character stretches and reaches up toward something overhead',    category: 'nature',       duration: 1.5, tags: ['reach','stretch','up','grasp','nature'],         confidence: 94, isStarter: true },
  { id: 'driving-pose',      name: 'Driving Pose',      description: 'Seated at wheel, slight forward lean, hands shifting position',   category: 'driving',      duration: 2.0, tags: ['drive','car','wheel','vehicle','seated'],        confidence: 89, isStarter: true },
  { id: 'combat-defense',    name: 'Combat Defense',    description: 'Guard position dropping into defensive crouch, protecting head',  category: 'fight',        duration: 1.0, tags: ['defend','block','guard','combat','defensive'],   confidence: 92, isStarter: true },
  { id: 'chase-sprint',      name: 'Chase Sprint',      description: 'Desperate full-body sprint with forward lean, arms driving',     category: 'chase',        duration: 1.5, tags: ['chase','run','pursue','sprint','escape'],        confidence: 93, isStarter: true },
  { id: 'falling-stumble',   name: 'Falling Stumble',   description: 'Character loses balance and falls forward, arms reaching out',   category: 'falling',      duration: 1.0, tags: ['fall','stumble','trip','ground','down'],         confidence: 88, isStarter: true },
  { id: 'romance-reach',     name: 'Romance Reach',     description: 'Tender reaching gesture toward someone, open embracing stance',  category: 'romance',      duration: 2.0, tags: ['romance','reach','tender','love','embrace'],     confidence: 91, isStarter: true },
];

// ── Motion Library Service ────────────────────────────────────────────────────

class MotionLibraryService {
  private allClips: MotionClip[] = [];
  private poseCache: Map<string, PoseKeyframe[]> = new Map();
  private loaded = false;
  private comfyBaseUrl: string | null = null;

  async getComfyBaseUrl(): Promise<string> {
    if (this.comfyBaseUrl) return this.comfyBaseUrl;
    if ((window as any).electronAPI?.getComfyUIProxyPort) {
      const port = await (window as any).electronAPI.getComfyUIProxyPort();
      if (port) {
        this.comfyBaseUrl = `http://127.0.0.1:${port}`;
        return this.comfyBaseUrl;
      }
    }
    return getComfyUIUrl();
  }

  /** Load the library index (starter + any clips from resources/motion_library/). */
  async loadLibrary(): Promise<MotionClip[]> {
    if (this.loaded) return this.allClips;

    // Build starter clips with rendered thumbnails
    const starterClips: MotionClip[] = await Promise.all(
      STARTER_INDEX.map(async (meta) => {
        let thumbnail: string | null = null;
        try {
          const seq = await this.loadStarterPoseSequence(meta.id);
          if (seq.length > 0) thumbnail = renderPoseToDataURL(seq[0], 120, 160);
        } catch { /* thumbnail stays null */ }
        return {
          ...meta,
          thumbnail,
          poseSequencePath: null,
        };
      })
    );

    // Merge with any full library clips loaded via IPC
    let fullLibraryClips: MotionClip[] = [];
    try {
      const result = await (window as any).electronAPI?.getMotionLibraryIndex?.();
      if (result?.success && Array.isArray(result.clips)) {
        fullLibraryClips = result.clips.filter(
          (c: MotionClip) => !starterClips.find((s) => s.id === c.id)
        );
      }
    } catch { /* full library unavailable — starter is enough */ }

    this.allClips = [...starterClips, ...fullLibraryClips];
    this.loaded = true;
    return this.allClips;
  }

  /** Keyword-first search, then LLM re-ranking for natural language queries. */
  async searchClips(description: string): Promise<MotionClip[]> {
    await this.loadLibrary();
    const query = description.toLowerCase().trim();
    if (!query) return this.allClips;

    // Score each clip by keyword overlap
    const scored = this.allClips.map((clip) => {
      const haystack = [clip.name, clip.description, clip.category, ...clip.tags]
        .join(' ')
        .toLowerCase();
      const words = query.split(/\s+/);
      let score = 0;
      for (const word of words) {
        if (word.length < 2) continue;
        if (haystack.includes(word)) score += 2;
        // Partial match
        if ([...haystack.split(' ')].some((h) => h.startsWith(word))) score += 1;
      }
      // Boost exact category match
      if (clip.category === query) score += 5;
      return { clip, score };
    });

    const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

    // If good keyword matches, return them
    if (relevant.length >= 3) return relevant.map((s) => s.clip).slice(0, 20);

    // Fall back to LLM semantic re-ranking for short results
    try {
      const clipList = this.allClips
        .map((c) => `id:${c.id} name:${c.name} tags:${c.tags.join(',')}`)
        .join('\n');
      const res = await fetch(`${getOllamaUrl()}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:latest',
          messages: [
            { role: 'system', content: 'You are a motion library search assistant. Return ONLY a JSON array of clip IDs matching the query, most relevant first, max 10.' },
            { role: 'user', content: `Query: "${description}"\nClips:\n${clipList}\nRespond with only a JSON array like ["id1","id2"]` },
          ],
          stream: false,
          options: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json() as { message: { content: string } };
        const content = data.message?.content ?? '';
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          const ids: string[] = JSON.parse(match[0]);
          if (Array.isArray(ids)) {
            return ids
              .map((id) => this.allClips.find((c) => c.id === id))
              .filter(Boolean) as MotionClip[];
          }
        }
      }
    } catch { /* ignore LLM errors, return keyword results */ }

    return relevant.length > 0
      ? relevant.map((s) => s.clip)
      : this.allClips.slice(0, 20);
  }

  /** Load pre-extracted pose sequence for a clip. */
  async getClipPoseSequence(clipId: string): Promise<PoseKeyframe[]> {
    if (this.poseCache.has(clipId)) return this.poseCache.get(clipId)!;

    // Try starter library first
    try {
      const seq = await this.loadStarterPoseSequence(clipId);
      if (seq.length > 0) {
        this.poseCache.set(clipId, seq);
        return seq;
      }
    } catch { /* not in starter library */ }

    // Try full library via IPC
    try {
      const result = await (window as any).electronAPI?.getMotionClipSequence?.(clipId);
      if (result?.success && Array.isArray(result.sequence)) {
        this.poseCache.set(clipId, result.sequence);
        return result.sequence;
      }
    } catch { /* unavailable */ }

    throw new Error(`Pose sequence not found for clip: ${clipId}`);
  }

  /**
   * Apply a library clip to a panel image via ComfyUI ControlNet + Wan 2.2.
   * Returns base64 video data URL.
   */
  async applyClipToCharacter(
    clipId: string,
    panelImageData: string,
    onProgress?: (pct: number, msg: string) => void
  ): Promise<{ videoData: string; videoPath: string | null }> {
    const clip = this.allClips.find((c) => c.id === clipId);
    const motionPrompt = clip
      ? `${clip.name}, ${clip.tags.join(', ')}`
      : 'smooth character animation, cinematic quality';

    if (licenseService.isPro() || licenseService.isStudio()) {
      onProgress?.(5, 'Sending to Kling cloud…');
      const cloudVideo = await comfyUIService.animatePanelCloud(
        panelImageData, motionPrompt, onProgress
      );
      if (cloudVideo) {
        onProgress?.(100, 'Animation complete');
        return { videoData: cloudVideo, videoPath: null };
      }
      onProgress?.(10, 'Cloud unavailable — trying local…');
    }

    onProgress?.(15, 'Sending to Wan 2.2…');
    const videoData = await comfyUIService.animatePanel(
      panelImageData,
      motionPrompt,
      onProgress,
    );
    onProgress?.(100, 'Animation complete');
    return { videoData, videoPath: null };
  }

  /** Upload a user's reference video and extract a pose sequence (Pro only). */
  async uploadReferenceVideo(
    videoPath: string
  ): Promise<MotionClip & { poseSequence: PoseKeyframe[] }> {
    const result = await (window as any).electronAPI?.extractVideoPose?.(videoPath);
    if (!result?.success) {
      throw new Error(result?.error ?? 'Failed to extract pose from video');
    }

    const sequence: PoseKeyframe[] = result.sequence;
    const thumbnail = sequence.length > 0 ? renderPoseToDataURL(sequence[0], 120, 160) : null;
    const id = `user_${Date.now()}`;
    const clip: MotionClip & { poseSequence: PoseKeyframe[] } = {
      id,
      name: result.name ?? 'Custom Motion',
      description: result.description ?? 'User-uploaded reference motion',
      category: 'action',
      duration: result.duration ?? sequence.length / 8,
      thumbnail,
      poseSequencePath: result.sequencePath ?? null,
      tags: ['custom', 'uploaded'],
      confidence: result.confidence ?? 75,
      poseSequence: sequence,
    };

    // Add to in-memory library
    this.allClips.unshift(clip);
    this.poseCache.set(id, sequence);
    return clip;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Load pose sequence from bundled resources via IPC. */
  private async loadStarterPoseSequence(clipId: string): Promise<PoseKeyframe[]> {
    const result = await (window as any).electronAPI?.getMotionClipSequence?.(clipId);
    if (result?.success && Array.isArray(result.sequence)) return result.sequence;
    throw new Error('not found');
  }

  private async pollComfyResult(
    baseUrl: string,
    promptId: string,
    onProgress?: (pct: number, msg: string) => void,
    timeoutMs = 600_000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let pct = 25;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const histRes = await fetch(`${baseUrl}/history/${promptId}`);
        if (!histRes.ok) continue;
        const history = await histRes.json();
        const entry = history[promptId];

        if (!entry) {
          // Still queued — pulse progress
          pct = Math.min(pct + 1, 90);
          onProgress?.(pct, 'Generating animation…');
          continue;
        }

        if (entry.status?.status_str === 'error') {
          throw new Error(entry.status.messages?.join(' ') ?? 'ComfyUI error');
        }

        // Find video output
        const outputs = entry.outputs ?? {};
        for (const nodeOut of Object.values(outputs) as any[]) {
          if (nodeOut?.videos?.length > 0) {
            const video = nodeOut.videos[0];
            const videoUrl = `${baseUrl}/view?filename=${encodeURIComponent(video.filename)}&type=output`;
            onProgress?.(95, 'Downloading result…');
            const blob = await (await fetch(videoUrl)).blob();
            return await this.blobToDataURL(blob);
          }
        }

        onProgress?.(pct, 'Processing output…');
        pct = Math.min(pct + 2, 90);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('ComfyUI error')) throw err;
      }
    }
    throw new Error('Motion generation timed out (10 min)');
  }

  private blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export const motionLibraryService = new MotionLibraryService();
