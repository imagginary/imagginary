import { MultiViewPaths, MeshResult } from '../types';
import { settingsService } from './SettingsService';
import { turntableService } from './TurntableService';

const INSTANTMESH_BASE_URL = 'http://127.0.0.1:7860';
const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export interface MultiViewResult {
  views: MultiViewPaths;
}

export class InstantMeshService {
  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${INSTANTMESH_BASE_URL}/info`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      try {
        const res = await fetch(INSTANTMESH_BASE_URL, {
          signal: AbortSignal.timeout(3000),
        });
        return res.ok;
      } catch {
        return false;
      }
    }
  }

  async generateMultiView(imageBase64: string): Promise<MultiViewResult | null> {
    // If a cloud provider is selected, delegate to TurntableService
    const provider = settingsService.get().turntable3dProvider;
    if (provider !== 'instantmesh') {
      // Cloud 3D providers (Meshy, Tripo) generate meshes, not multiview images —
      // return null so the caller falls back to prompt-only character generation.
      await turntableService.generateMultiView(imageBase64);
      return null;
    }

    const connected = await this.checkConnection();
    if (!connected) return null;

    try {
      // Strip data URL prefix if present
      const base64Data = imageBase64.replace(/^data:image\/[^;]+;base64,/, '');

      const res = await fetch(`${INSTANTMESH_BASE_URL}/api/multiview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Data,
          sample_steps: 20,
          seed: 42,
          remove_background: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        console.error('[InstantMesh] /api/multiview returned', res.status);
        return null;
      }

      const result = await res.json() as { views?: string[]; error?: string };
      if (result.error || !result.views || result.views.length < 6) {
        console.error('[InstantMesh] Bad response:', result.error);
        return null;
      }

      const views = result.views;

      // Zero123++ grid layout (row-major, 3 rows × 2 cols):
      // [0] front-left  [1] front-right
      // [2] left        [3] right
      // [4] back-left   [5] back-right
      // Map to our 6-angle set: front, frontLeft, left, back, right, frontRight
      return {
        views: {
          front: `data:image/png;base64,${views[0]}`,
          frontLeft: `data:image/png;base64,${views[1]}`,
          left: `data:image/png;base64,${views[2]}`,
          back: `data:image/png;base64,${views[4]}`,
          right: `data:image/png;base64,${views[3]}`,
          frontRight: `data:image/png;base64,${views[5]}`,
        },
      };
    } catch (error) {
      console.error('[InstantMesh] generateMultiView failed:', error);
      return null;
    }
  }

  /**
   * Generate a 3D mesh (OBJ + GLB) and turntable video from a character portrait.
   * Delegates file I/O to the main process via IPC — requires InstantMesh on port 7860.
   * GPU required on the InstantMesh server side.
   */
  async generate3DMesh(characterId: string, portraitImagePath: string): Promise<MeshResult | null> {
    const api = (window as unknown as { electronAPI?: { generate3DMesh?: (p: unknown) => Promise<unknown> } }).electronAPI;
    if (!api?.generate3DMesh) {
      console.error('[InstantMesh] generate3DMesh IPC not available');
      return null;
    }
    const result = await api.generate3DMesh({ characterId, portraitImagePath }) as {
      success: boolean;
      objPath?: string;
      glbPath?: string;
      turntableVideoPath?: string;
      error?: string;
    };
    if (!result.success || !result.objPath) {
      console.error('[InstantMesh] generate3DMesh failed:', result.error);
      return null;
    }
    return {
      objPath: result.objPath,
      glbPath: result.glbPath ?? '',
      turntableVideoPath: result.turntableVideoPath ?? '',
      multiViewPaths: { front: '', frontLeft: '', left: '', back: '', right: '', frontRight: '' },
    };
  }

  /**
   * Render a 360° turntable video from an existing OBJ file.
   * GPU required on the InstantMesh server side.
   */
  async generateTurntableVideo(objPath: string): Promise<string | null> {
    const connected = await this.checkConnection();
    if (!connected) return null;

    try {
      const res = await fetch(`${INSTANTMESH_BASE_URL}/api/generate_turntable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obj_path: objPath }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const result = await res.json() as { video_url?: string; error?: string };
      return result.video_url ?? null;
    } catch (error) {
      console.error('[InstantMesh] generateTurntableVideo failed:', error);
      return null;
    }
  }
}

export const instantMeshService = new InstantMeshService();
