import { License, LicenseTier } from '../types';

class LicenseService {
  private license: License | null = null;
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const stored = await (window as any).electronAPI.getLicense();
      if (stored) this.license = stored as License;
    } catch {
      this.license = null;
    }
  }

  async validate(key: string): Promise<{ valid: boolean; error?: string }> {
    const trimmed = key.trim();
    if (!trimmed) return { valid: false, error: 'Please enter a license key.' };
    try {
      const result = await (window as any).electronAPI.validateLicense(trimmed);
      if (result.valid) {
        this.license = {
          key: trimmed,
          tier: result.tier,
          email: result.email,
          activatedAt: Date.now(),
          expiresAt: result.expiresAt ?? null,
        };
      }
      return result;
    } catch (err: any) {
      return { valid: false, error: err?.message ?? 'Validation failed.' };
    }
  }

  openCheckout(tier: 'pro' | 'studio'): void {
    (window as any).electronAPI.openCheckout(tier);
  }

  async deactivate(): Promise<void> {
    this.license = null;
    await (window as any).electronAPI.clearLicense();
  }

  getTier(): LicenseTier { return this.license?.tier ?? 'community'; }
  isPro(): boolean { const t = this.getTier(); return t === 'pro' || t === 'studio'; }
  isStudio(): boolean { return this.getTier() === 'studio'; }
  getLicense(): License | null { return this.license; }
  getEmail(): string | null { return this.license?.email ?? null; }
}

export const licenseService = new LicenseService();
