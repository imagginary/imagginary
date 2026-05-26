import { settingsService } from './SettingsService';

class TurntableService {
  getProvider() { return settingsService.get().turntable3dProvider; }

  async generateMultiView(imageBase64: string): Promise<{ glbUrl: string; thumbnailUrl: string } | null> {
    const provider = this.getProvider();

    if (provider === 'instantmesh') {
      return null; // fall through to existing InstantMeshService
    }

    if (provider === 'meshy') {
      return this.generateMeshy(imageBase64);
    }

    if (provider === 'tripo') {
      return this.generateTripo(imageBase64);
    }

    return null;
  }

  private async generateMeshy(imageBase64: string): Promise<{ glbUrl: string; thumbnailUrl: string } | null> {
    const apiKey = settingsService.getKey('meshyApiKey');
    if (!apiKey) return null;
    try {
      const res = await fetch('https://api.meshy.ai/v1/image-to-3d', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: `data:image/png;base64,${imageBase64}`, enable_pbr: false }),
      });
      if (!res.ok) return null;
      const job = await res.json() as { result: string };
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const poll = await fetch(`https://api.meshy.ai/v1/image-to-3d/${job.result}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const status = await poll.json() as { status: string; model_urls?: { glb?: string }; thumbnail_url?: string };
        if (status.status === 'SUCCEEDED') {
          return { glbUrl: status.model_urls?.glb ?? '', thumbnailUrl: status.thumbnail_url ?? '' };
        }
        if (status.status === 'FAILED') return null;
      }
      return null;
    } catch { return null; }
  }

  private async generateTripo(imageBase64: string): Promise<{ glbUrl: string; thumbnailUrl: string } | null> {
    const apiKey = settingsService.getKey('tripoApiKey');
    if (!apiKey) return null;
    try {
      const res = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image_to_model', file: { type: 'png', data: imageBase64 } }),
      });
      if (!res.ok) return null;
      const job = await res.json() as { data: { task_id: string } };
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const poll = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${job.data.task_id}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const status = await poll.json() as { data?: { status: string; output?: { model?: string; rendered_image?: string } } };
        if (status.data?.status === 'success') {
          return { glbUrl: status.data.output?.model ?? '', thumbnailUrl: status.data.output?.rendered_image ?? '' };
        }
        if (status.data?.status === 'failed') return null;
      }
      return null;
    } catch { return null; }
  }
}

export const turntableService = new TurntableService();
