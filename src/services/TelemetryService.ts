const UMAMI_ENDPOINT = 'https://analytics.umami.is/api/send';
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID ?? '';
const CONSENT_KEY = 'imagginary_telemetry_consent'; // 'granted' | 'denied' | null

export class TelemetryService {
  private consented: boolean = false;

  init(): void {
    const stored = localStorage.getItem(CONSENT_KEY);
    this.consented = stored === 'granted';
  }

  hasConsented(): boolean {
    return this.consented;
  }

  hasAnswered(): boolean {
    return localStorage.getItem(CONSENT_KEY) !== null;
  }

  grant(): void {
    localStorage.setItem(CONSENT_KEY, 'granted');
    this.consented = true;
    this.track('telemetry_opted_in');
  }

  deny(): void {
    localStorage.setItem(CONSENT_KEY, 'denied');
    this.consented = false;
  }

  track(eventName: string, data?: Record<string, string | number | boolean>): void {
    if (!this.consented || !UMAMI_WEBSITE_ID) return;
    fetch(UMAMI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: UMAMI_WEBSITE_ID,
          name: eventName,
          data,
          url: '/app',
          referrer: '',
          title: 'Imagginary',
          language: navigator.language,
          screen: `${window.screen.width}x${window.screen.height}`,
        },
      }),
    }).catch(() => {}); // fire-and-forget, never throw
  }
}

export const telemetryService = new TelemetryService();
