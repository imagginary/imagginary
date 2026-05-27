import { License, LicenseTier } from '../types';

export interface CreditUsage {
  inpaints: number;
  characterPanels: number;
  lipSyncClips: number;
  periodStart: number; // timestamp of billing cycle start
}

const CREDIT_LIMITS = {
  pro:       { inpaints: 60,  characterPanels: 200,  lipSyncClips: 30  },
  studio:    { inpaints: 300, characterPanels: 1000, lipSyncClips: 150 },
  community: { inpaints: 0,   characterPanels: 0,    lipSyncClips: 0   },
};

const USAGE_KEY = 'imagginary_credit_usage';

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

  getUsage(): CreditUsage {
    try {
      const raw = localStorage.getItem(USAGE_KEY);
      if (!raw) return this.resetUsage();
      const usage: CreditUsage = JSON.parse(raw);
      if (Date.now() - usage.periodStart > 30 * 24 * 60 * 60 * 1000) {
        return this.resetUsage();
      }
      return usage;
    } catch { return this.resetUsage(); }
  }

  resetUsage(): CreditUsage {
    const usage: CreditUsage = {
      inpaints: 0,
      characterPanels: 0,
      lipSyncClips: 0,
      periodStart: Date.now(),
    };
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    return usage;
  }

  incrementUsage(type: keyof Omit<CreditUsage, 'periodStart'>, amount = 1): void {
    const usage = this.getUsage();
    usage[type] += amount;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  }

  canUse(type: keyof Omit<CreditUsage, 'periodStart'>): boolean {
    const tier = this.getTier();
    const limits = CREDIT_LIMITS[tier];
    const usage = this.getUsage();
    return usage[type] < limits[type];
  }

  getRemainingCredits(type: keyof Omit<CreditUsage, 'periodStart'>): number {
    const tier = this.getTier();
    const limits = CREDIT_LIMITS[tier];
    const usage = this.getUsage();
    return Math.max(0, limits[type] - usage[type]);
  }

  getLimit(type: keyof Omit<CreditUsage, 'periodStart'>): number {
    return CREDIT_LIMITS[this.getTier()][type];
  }
}

export const licenseService = new LicenseService();
