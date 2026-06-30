class TurntableService {
  async generateMultiView(_imageBase64: string): Promise<{ glbUrl: string; thumbnailUrl: string } | null> {
    // Not yet implemented — callers must check for null and show a "Coming Soon" message
    console.warn('[TurntableService] generateMultiView is not yet implemented (Coming Soon)');
    return null;
  }
}

export const turntableService = new TurntableService();
