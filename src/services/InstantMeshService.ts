import { MultiViewPaths } from '../types';

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
}

export const instantMeshService = new InstantMeshService();
