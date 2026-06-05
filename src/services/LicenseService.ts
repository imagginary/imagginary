import { License, LicenseTier, CreditBalance } from '../types';

const BALANCE_KEY = 'imagginary_credit_balance';
const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000;
const BILLING_CYCLE = 30 * 24 * 60 * 60 * 1000;

export const CREDIT_POOLS: Record<LicenseTier, number> = {
  pro:       532,
  studio:    2239,
  community: 0,
};

export const CREDIT_COSTS = {
  panelCloud:      2,
  inpaint:         3,
  characterPanel:  2,
  motionClip:     14,
  lipSync:        16,
  turntable:       2,
};

class LicenseService {
  private license: License | null = null;
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const stored = await (window as any).electronAPI.getLicense();
      if (stored) {
        this.license = stored as License;
        this.checkAndAddMonthlyCredits();
        this.maybeRevalidate();
      }
    } catch {
      this.license = null;
    }
  }

  private checkAndAddMonthlyCredits(): void {
    if (!this.license || this.getTier() === 'community') return;
    const balance = this.getBalance();
    const now = Date.now();
    if (now - balance.lastCreditedAt >= BILLING_CYCLE) {
      const allocation = CREDIT_POOLS[this.getTier()] ?? 0;
      const newBalance: CreditBalance = {
        subscriptionCredits: balance.subscriptionCredits + allocation,
        topUpCredits: balance.topUpCredits,
        lastCreditedAt: now,
        tier: this.getTier(),
      };
      localStorage.setItem(BALANCE_KEY, JSON.stringify(newBalance));
      console.log(`[Credits] Added ${allocation} subscription credits. Total: ${newBalance.subscriptionCredits + newBalance.topUpCredits}`);
    }
  }

  private maybeRevalidate(): void {
    if (!this.license) return;
    const lastValidated = this.license.lastValidatedAt ?? 0;
    if (Date.now() - lastValidated < VALIDATION_INTERVAL) return;

    setTimeout(async () => {
      try {
        const result = await (window as any).electronAPI.validateLicense(this.license!.key);
        if (result.valid) {
          const updated: License = {
            ...this.license!,
            lastValidatedAt: Date.now(),
            tier: result.tier,
          };
          this.license = updated;
          await (window as any).electronAPI.saveLicense(updated);
          this.checkAndAddMonthlyCredits();
        } else {
          console.log('[License] Re-validation failed:', result.error, '— downgrading to Community on next launch');
          await (window as any).electronAPI.clearLicense();
        }
      } catch {
        console.log('[License] Re-validation network error — will retry tomorrow');
      }
    }, 2000);
  }

  getBalance(): CreditBalance {
    try {
      const raw = localStorage.getItem(BALANCE_KEY);
      if (!raw) return this.initBalance();
      const balance: CreditBalance = JSON.parse(raw);
      if (balance.tier !== this.getTier() && this.getTier() !== 'community') {
        const updated = { ...balance, tier: this.getTier() };
        localStorage.setItem(BALANCE_KEY, JSON.stringify(updated));
        return updated;
      }
      return balance;
    } catch {
      return this.initBalance();
    }
  }

  private initBalance(): CreditBalance {
    const tier = this.getTier();
    const initial: CreditBalance = {
      subscriptionCredits: CREDIT_POOLS[tier] ?? 0,
      topUpCredits: 0,
      lastCreditedAt: Date.now(),
      tier,
    };
    localStorage.setItem(BALANCE_KEY, JSON.stringify(initial));
    return initial;
  }

  hasCredits(cost: number): boolean {
    if (this.getTier() === 'community') return false;
    const balance = this.getBalance();
    return (balance.subscriptionCredits + balance.topUpCredits) >= cost;
  }

  spendCredits(cost: number): void {
    const balance = this.getBalance();
    let remaining = cost;
    if (balance.topUpCredits > 0) {
      const fromTopUp = Math.min(balance.topUpCredits, remaining);
      balance.topUpCredits -= fromTopUp;
      remaining -= fromTopUp;
    }
    if (remaining > 0) {
      balance.subscriptionCredits = Math.max(0, balance.subscriptionCredits - remaining);
    }
    localStorage.setItem(BALANCE_KEY, JSON.stringify(balance));
  }

  addTopUpCredits(amount: number): void {
    const balance = this.getBalance();
    balance.topUpCredits += amount;
    localStorage.setItem(BALANCE_KEY, JSON.stringify(balance));
  }

  getRemainingCredits(): number {
    const balance = this.getBalance();
    return balance.subscriptionCredits + balance.topUpCredits;
  }

  getSubscriptionCredits(): number {
    return this.getBalance().subscriptionCredits;
  }

  getTopUpCredits(): number {
    return this.getBalance().topUpCredits;
  }

  getDaysUntilNextCredit(): number {
    const balance = this.getBalance();
    const nextCredit = balance.lastCreditedAt + BILLING_CYCLE;
    return Math.max(0, Math.ceil((nextCredit - Date.now()) / (24 * 60 * 60 * 1000)));
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
          lastValidatedAt: Date.now(),
          lastCreditedAt: Date.now(),
        };
        localStorage.removeItem(BALANCE_KEY);
        this.initBalance();
      }
      return result;
    } catch (err: any) {
      return { valid: false, error: err?.message ?? 'Validation failed.' };
    }
  }

  async deactivate(): Promise<void> {
    this.license = null;
    localStorage.removeItem(BALANCE_KEY);
    await (window as any).electronAPI.clearLicense();
  }

  openCheckout(tier: 'pro' | 'studio' | 'pro_annual' | 'studio_annual'): void {
    (window as any).electronAPI.openCheckout(tier);
  }

  openCustomerPortal(): void {
    (window as any).electronAPI.openCustomerPortal();
  }

  getTier(): LicenseTier { return this.license?.tier ?? 'community'; }
  isPro(): boolean { const t = this.getTier(); return t === 'pro' || t === 'studio'; }
  isStudio(): boolean { return this.getTier() === 'studio'; }
  getLicense(): License | null { return this.license; }
  getEmail(): string | null { return this.license?.email ?? null; }
  getTotalCredits(): number { return CREDIT_POOLS[this.getTier()] ?? 0; }
}

export const licenseService = new LicenseService();
