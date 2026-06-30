import { License, LicenseTier, CreditBalance } from '../types';

const VALIDATION_INTERVAL = 24 * 60 * 60 * 1000;
const BILLING_CYCLE = 30 * 24 * 60 * 60 * 1000;
const LEGACY_BALANCE_KEY = 'imagginary_credit_balance';

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
  loraTraining:   50,
};

// In-memory cache of the balance — kept in sync after every async mutation.
// Sync reads (getBalance, hasCredits) use this cache so React render functions
// don't need to be async.
interface BalanceCache {
  subscriptionCredits: number;
  topUpCredits: number;
  lastCreditedAt: number;
}

class LicenseService {
  private license: License | null = null;
  private loaded = false;
  private _cache: BalanceCache = { subscriptionCredits: 0, topUpCredits: 0, lastCreditedAt: 0 };

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      // ── One-time migration from localStorage ──────────────────────────────
      const legacy = localStorage.getItem(LEGACY_BALANCE_KEY);
      if (legacy) {
        try {
          const old = JSON.parse(legacy);
          await window.electronAPI?.setCredits?.({
            subscriptionCredits: old.subscriptionCredits ?? 0,
            topUpCredits:        old.topUpCredits        ?? 0,
            lastCreditedAt:      old.lastCreditedAt      ?? 0,
          });
        } catch { /* ignore migration errors, main-process store wins */ }
        localStorage.removeItem(LEGACY_BALANCE_KEY);
      }

      // ── Load balance from main process ────────────────────────────────────
      const bal = await window.electronAPI?.getCredits?.();
      if (bal) {
        this._cache = {
          subscriptionCredits: bal.subscriptionCredits ?? 0,
          topUpCredits:        bal.topUpCredits        ?? 0,
          lastCreditedAt:      bal.lastCreditedAt      ?? 0,
        };
      }

      // ── Load license ──────────────────────────────────────────────────────
      const stored = await window.electronAPI?.getLicense?.();
      if (stored) {
        this.license = stored as License;
        await this.checkAndAddMonthlyCredits();
        this.maybeRevalidate();
      }
    } catch {
      this.license = null;
    }
  }

  private async checkAndAddMonthlyCredits(): Promise<void> {
    if (!this.license || this.getTier() === 'community') return;
    const now = Date.now();
    if (now - this._cache.lastCreditedAt < BILLING_CYCLE) return;
    const allocation = CREDIT_POOLS[this.getTier()] ?? 0;
    this._cache = {
      subscriptionCredits: this._cache.subscriptionCredits + allocation,
      topUpCredits:        this._cache.topUpCredits,
      lastCreditedAt:      now,
    };
    await window.electronAPI!.setCredits(this._cache);
    console.log(`[Credits] Added ${allocation} subscription credits. Total: ${this._cache.subscriptionCredits + this._cache.topUpCredits}`);
  }

  private maybeRevalidate(): void {
    if (!this.license) return;
    const lastValidated = this.license.lastValidatedAt ?? 0;
    if (Date.now() - lastValidated < VALIDATION_INTERVAL) return;

    setTimeout(async () => {
      try {
        const result = await window.electronAPI!.validateLicense(this.license!.key);
        if (result.valid) {
          const updated: License = {
            ...this.license!,
            lastValidatedAt: Date.now(),
            tier: result.tier,
          };
          this.license = updated;
          await window.electronAPI!.saveLicense(updated);
          await this.checkAndAddMonthlyCredits();
        } else {
          console.log('[License] Re-validation failed:', result.error, '— downgrading to Community on next launch');
          await window.electronAPI!.clearLicense();
        }
      } catch {
        console.log('[License] Re-validation network error — will retry tomorrow');
        const MAX_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
        if (this.license && Date.now() - (this.license.lastValidatedAt ?? 0) > MAX_GRACE_MS) {
          await window.electronAPI!.clearLicense();
          this.license = null;
        }
      }
    }, 2000);
  }

  // Sync read from in-memory cache — safe to call in React render.
  getBalance(): CreditBalance {
    return {
      subscriptionCredits: this._cache.subscriptionCredits,
      topUpCredits:        this._cache.topUpCredits,
      lastCreditedAt:      this._cache.lastCreditedAt,
      tier:                this.getTier(),
    };
  }

  // Sync check from cache — UX gate only. Main process enforces via spend-credits.
  hasCredits(cost: number): boolean {
    if (this.getTier() === 'community') return false;
    return (this._cache.subscriptionCredits + this._cache.topUpCredits) >= cost;
  }

  async spendCredits(cost: number): Promise<boolean> {
    const result = await window.electronAPI!.spendCredits(cost);
    if (result?.success) {
      // Mirror the main-process spend logic to keep the cache accurate:
      // subscription is spent first (expires monthly), top-up preserved longest.
      const newSub = Math.max(0, this._cache.subscriptionCredits - cost);
      const remainder = cost - (this._cache.subscriptionCredits - newSub);
      const newTopUp = Math.max(0, this._cache.topUpCredits - remainder);
      this._cache = {
        subscriptionCredits: newSub,
        topUpCredits:        newTopUp,
        lastCreditedAt:      this._cache.lastCreditedAt,
      };
    }
    return result?.success ?? false;
  }

  /**
   * Re-reads the balance from the main-process electron-store and updates the
   * renderer cache.  Call this after any cloud handler that deducts credits
   * atomically in the main process without going through spendCredits(), so the
   * UI immediately reflects the correct post-generation balance.
   */
  async refreshBalanceFromStore(): Promise<void> {
    const credits = await window.electronAPI?.getCredits?.();
    if (credits) {
      this._cache.subscriptionCredits = credits.subscriptionCredits;
      this._cache.topUpCredits        = credits.topUpCredits;
      // lastCreditedAt is managed by checkAndAddMonthlyCredits — don't overwrite it
    }
  }

  async addTopUpCredits(amount: number): Promise<void> {
    this._cache = {
      ...this._cache,
      topUpCredits: this._cache.topUpCredits + amount,
    };
    await window.electronAPI!.setCredits(this._cache);
  }

  private async initBalance(): Promise<void> {
    const tier = this.getTier();
    this._cache = {
      subscriptionCredits: CREDIT_POOLS[tier] ?? 0,
      topUpCredits:        0,
      lastCreditedAt:      Date.now(),
    };
    await window.electronAPI!.setCredits(this._cache);
  }

  async validate(key: string): Promise<{ valid: boolean; error?: string }> {
    const trimmed = key.trim();
    if (!trimmed) return { valid: false, error: 'Please enter a license key.' };
    try {
      const result = await window.electronAPI!.validateLicense(trimmed);
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
        // Only grant the initial allocation on first-ever activation.
        // On reactivation, preserve existing credits and only check if a
        // monthly refresh is due — prevents the deactivate→reactivate exploit.
        // NOTE: a determined user can wipe electron-store to reset lastCreditedAt;
        // a server-side credit ledger would be needed to fully close that gap (v2).
        if (this._cache.lastCreditedAt === 0) {
          await this.initBalance();
        } else {
          await this.checkAndAddMonthlyCredits();
        }
        console.log('[LicenseService] validate complete — this.license.tier:', this.license?.tier, '— isPro:', this.isPro());
      }
      return result;
    } catch (err: any) {
      return { valid: false, error: err?.message ?? 'Validation failed.' };
    }
  }

  async deactivate(): Promise<void> {
    // Credits persist — they represent value tied to the key, not the activation state.
    // Zeroing them here would let the user deactivate → reactivate to farm fresh credits.
    this.license = null;
    await window.electronAPI!.clearLicense();
  }

  openCheckout(tier: 'pro' | 'studio' | 'pro_annual' | 'studio_annual'): void {
    window.electronAPI!.openCheckout(tier);
  }

  openCustomerPortal(): void {
    window.electronAPI!.openCustomerPortal();
  }

  openTopupCheckout(pack: 'starter' | 'standard' | 'power'): void {
    window.electronAPI!.openTopupCheckout(pack);
  }

  getTier(): LicenseTier { return this.license?.tier ?? 'community'; }
  isPro(): boolean { const t = this.getTier(); return t === 'pro' || t === 'studio'; }
  isStudio(): boolean { return this.getTier() === 'studio'; }
  getLicense(): License | null { return this.license; }
  getEmail(): string | null { return this.license?.email ?? null; }
  getTotalCredits(): number { return CREDIT_POOLS[this.getTier()] ?? 0; }

  getRemainingCredits(): number {
    return this._cache.subscriptionCredits + this._cache.topUpCredits;
  }

  getSubscriptionCredits(): number { return this._cache.subscriptionCredits; }
  getTopUpCredits(): number { return this._cache.topUpCredits; }

  getDaysUntilNextCredit(): number {
    const nextCredit = this._cache.lastCreditedAt + BILLING_CYCLE;
    return Math.max(0, Math.ceil((nextCredit - Date.now()) / (24 * 60 * 60 * 1000)));
  }
}

export const licenseService = new LicenseService();
