class TurntableService {
  async generateMultiView(_imageBase64: string): Promise<{ glbUrl: string; thumbnailUrl: string } | null> {
    return null; // Coming Soon
  }
}

export const turntableService = new TurntableService();
