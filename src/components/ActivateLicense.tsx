import React, { useState, useCallback } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Star, Zap, ExternalLink } from 'lucide-react';
import { License } from '../types';
import { licenseService, CREDIT_POOLS } from '../services/LicenseService';
import CreditUsageBar from './CreditUsageBar';

interface ActivateLicenseProps {
  currentLicense: License | null;
  onLicenseChange: () => void;
  onClose: () => void;
}

function TierBadge({ tier }: { tier: 'pro' | 'studio' }) {
  return tier === 'studio' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-violet-900/40 text-violet-300 border border-violet-700/40">
      <Star className="w-2.5 h-2.5" /> Studio
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase bg-imagginary-900/40 text-imagginary-300 border border-imagginary-700/40">
      <Zap className="w-2.5 h-2.5" /> Pro
    </span>
  );
}

function CommunityView({ onLicenseChange, onClose }: { onLicenseChange: () => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const handleActivate = useCallback(async () => {
    setError(null);
    setValidating(true);
    const result = await licenseService.validate(key);
    setValidating(false);
    if (result.valid) {
      onLicenseChange();
      onClose();
    } else {
      setError(result.error ?? 'Invalid key.');
    }
  }, [key, onLicenseChange, onClose]);

  return (
    <div className="p-6 space-y-5">
      <div>
        <p className="text-base font-bold text-gray-100">Unlock Pro Features</p>
        <p className="text-xs text-gray-500 mt-1">
          Motion generation, voice synthesis, pose engine, revision history, and more.
        </p>
      </div>

      {/* Billing cycle toggle */}
      <div className="flex items-center gap-3 justify-center">
        <button
          onClick={() => setBillingCycle('monthly')}
          className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
            billingCycle === 'monthly'
              ? 'bg-imagginary-500 text-black font-medium'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingCycle('annual')}
          className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
            billingCycle === 'annual'
              ? 'bg-imagginary-500 text-black font-medium'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Annual
          <span className="ml-1.5 text-xs bg-green-900/60 text-green-400 px-1.5 py-0.5 rounded">
            Save 17%
          </span>
        </button>
      </div>

      {/* Pricing cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Pro */}
        <div
          className="rounded-xl border border-imagginary-800/50 bg-imagginary-950/30 p-4 flex flex-col gap-3 cursor-pointer hover:border-imagginary-600 transition-colors"
          onClick={() => licenseService.openCheckout(billingCycle === 'annual' ? 'pro_annual' : 'pro')}
        >
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="w-3.5 h-3.5 text-imagginary-400" />
              <span className="text-xs font-bold text-imagginary-300 uppercase tracking-wide">Pro</span>
            </div>
            {billingCycle === 'monthly' ? (
              <p className="text-xl font-bold text-gray-100">
                $19<span className="text-sm font-normal text-gray-500">/mo</span>
              </p>
            ) : (
              <div>
                <p className="text-xl font-bold text-gray-100">
                  $15.83<span className="text-sm font-normal text-gray-500">/mo</span>
                </p>
                <p className="text-xs text-gray-600 mt-0.5">billed $190/yr</p>
              </div>
            )}
          </div>
          <ul className="space-y-1 text-[11px] text-gray-400">
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />532 credits/month ($5.32 value)</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Director's Eye inpainting</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Character-consistent panels</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Lip sync + motion clips</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Style Vault Pro styles</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Pose Engine + Voice Layer</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />PDF + FCPXML export</li>
          </ul>
          <button
            onClick={(e) => e.stopPropagation()}
            className="mt-auto flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Upgrade to Pro
          </button>
        </div>

        {/* Studio */}
        <div
          className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-4 flex flex-col gap-3 cursor-pointer hover:border-violet-600 transition-colors"
          onClick={() => licenseService.openCheckout(billingCycle === 'annual' ? 'studio_annual' : 'studio')}
        >
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Star className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs font-bold text-violet-300 uppercase tracking-wide">Studio</span>
            </div>
            {billingCycle === 'monthly' ? (
              <p className="text-xl font-bold text-gray-100">
                $79<span className="text-sm font-normal text-gray-500">/mo</span>
              </p>
            ) : (
              <div>
                <p className="text-xl font-bold text-gray-100">
                  $65.83<span className="text-sm font-normal text-gray-500">/mo</span>
                </p>
                <p className="text-xs text-gray-600 mt-0.5">billed $790/yr</p>
              </div>
            )}
          </div>
          <ul className="space-y-1 text-[11px] text-gray-400">
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Everything in Pro</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />2,239 credits/month ($22.39 value)</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Shared Studio collaboration</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Custom voice cloning</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Broadcast resolution (1536×864)</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Brand style training — train on your own visual references</li>
          </ul>
          <button
            onClick={(e) => e.stopPropagation()}
            className="mt-auto flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Upgrade to Studio
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-800" />
        <span className="text-[11px] text-gray-600">Already purchased?</span>
        <div className="flex-1 h-px bg-gray-800" />
      </div>

      {/* Key input */}
      <div className="space-y-2">
        <input
          type="text"
          value={key}
          onChange={(e) => { setKey(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && !validating && key.trim() && handleActivate()}
          placeholder="Paste your license key (lk_live_…)"
          className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors font-mono"
        />

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {error}
          </div>
        )}

        <button
          onClick={handleActivate}
          disabled={!key.trim() || validating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-gray-700"
        >
          {validating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Validating…</>
          ) : (
            'Activate'
          )}
        </button>

        <p className="text-[10px] text-gray-700 text-center">
          After payment, Dodo Payments will email you a license key
        </p>
      </div>
    </div>
  );
}

function ActivatedView({ license, onLicenseChange, onClose }: {
  license: License;
  onLicenseChange: () => void;
  onClose: () => void;
}) {
  const [deactivating, setDeactivating] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [topupCode, setTopupCode] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupResult, setTopupResult] = useState<string | null>(null);

  const tier = license.tier === 'studio' ? 'studio' : 'pro';
  const balance = licenseService.getBalance();
  const subCredits = balance.subscriptionCredits;
  const topUpCredits = balance.topUpCredits;
  const daysUntilNext = licenseService.getDaysUntilNextCredit();
  const monthlyPool = CREDIT_POOLS[tier];

  const handleDeactivate = useCallback(async () => {
    setDeactivating(true);
    await licenseService.deactivate();
    onLicenseChange();
    onClose();
  }, [onLicenseChange, onClose]);

  const handleRedeemTopup = useCallback(async () => {
    setTopupLoading(true);
    setTopupResult(null);
    const result = await window.electronAPI!.validateTopup(topupCode.trim());
    if (result.valid) {
      await licenseService.addTopUpCredits(result.credits);
      setTopupResult(`✓ ${result.credits} credits added to your account`);
      setTopupCode('');
      onLicenseChange();
    } else {
      setTopupResult(`✗ ${result.error}`);
    }
    setTopupLoading(false);
  }, [topupCode, onLicenseChange]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <CheckCircle className="w-10 h-10 text-green-400" />
        <div>
          <p className="text-sm font-bold text-gray-100 mb-2">License Active</p>
          <TierBadge tier={tier} />
        </div>
        <p className="text-xs text-gray-500">{license.email}</p>
      </div>

      <div className="text-xs text-gray-400 bg-gray-800/50 rounded-lg p-3 mb-4">
        <p className="text-amber-400 font-medium mb-1">✦ Cloud generation is active</p>
        <p>Every panel now generates via FLUX.1 Schnell in the cloud — no downloads needed. Credits are spent per generation.</p>
      </div>

      {/* Credit balance */}
      <div className="border-t border-gray-800 pt-3 space-y-3">
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-gray-400">
              {subCredits} subscription{topUpCredits > 0 ? ` + ${topUpCredits} top-up = ${subCredits + topUpCredits}` : ''} credits
            </span>
            <span className="text-gray-600">+{monthlyPool} in {daysUntilNext}d</span>
          </div>
          <CreditUsageBar showCosts={false} />
        </div>

        {/* Buy more credits */}
        <div className="space-y-2 pt-3 border-t border-gray-800">
          <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Buy more credits</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { pack: 'starter'  as const, credits: 300,  price: '$3.99' },
              { pack: 'standard' as const, credits: 800,  price: '$9.99' },
              { pack: 'power'    as const, credits: 2000, price: '$21.99' },
            ].map(({ pack, credits, price }) => (
              <button
                key={pack}
                onClick={() => licenseService.openTopupCheckout(pack)}
                className="flex flex-col items-center gap-1 py-2.5 px-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg transition-colors"
              >
                <span className="text-xs font-medium text-gray-200">{credits}</span>
                <span className="text-[9px] text-gray-500">credits</span>
                <span className="text-[10px] text-amber-400 font-medium">{price}</span>
              </button>
            ))}
          </div>
          <p className="text-[9px] text-gray-700">Credits never expire. After purchase, redeem with the code Dodo emails you.</p>
        </div>

        {/* Top-up redemption */}
        <div>
          <button
            onClick={() => setShowTopup(!showTopup)}
            className="text-xs text-gray-600 hover:text-gray-400 underline"
          >
            {showTopup ? 'Hide' : 'Redeem top-up code'}
          </button>

          {showTopup && (
            <div className="space-y-2 pt-2">
              <input
                value={topupCode}
                onChange={(e) => setTopupCode(e.target.value)}
                placeholder="Paste your top-up code"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
              />
              <button
                onClick={handleRedeemTopup}
                disabled={!topupCode.trim() || topupLoading}
                className="w-full py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded transition-colors disabled:opacity-50"
              >
                {topupLoading ? 'Validating…' : 'Redeem'}
              </button>
              {topupResult && (
                <p className={`text-[10px] ${topupResult.startsWith('✓') ? 'text-green-500' : 'text-red-400'}`}>
                  {topupResult}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {license?.tier === 'pro' && (
        <div className="border border-violet-500/30 rounded-xl p-4 bg-violet-500/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-violet-400 font-semibold text-sm">✦ Upgrade to Studio</span>
            <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">$79/mo</span>
          </div>
          <ul className="text-xs text-gray-400 space-y-1 mb-3">
            <li>· 2,239 credits/month (4.2× more than Pro)</li>
            <li>· Shared Studio — real-time collaboration</li>
            <li>· Custom voice cloning</li>
            <li>· Broadcast resolution (1536×864)</li>
            <li>· Brand style training — train on your own visual references</li>
          </ul>
          <button
            onClick={() => licenseService.openCheckout('studio')}
            className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
          >
            Upgrade to Studio →
          </button>
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={() => licenseService.openCustomerPortal()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Manage Subscription →
        </button>

        <button
          onClick={handleDeactivate}
          disabled={deactivating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors"
        >
          {deactivating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {deactivating ? 'Deactivating…' : 'Deactivate on this machine'}
        </button>
      </div>
    </div>
  );
}

export default function ActivateLicense({ currentLicense, onLicenseChange, onClose }: ActivateLicenseProps) {
  const isActivated = currentLicense !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header — always visible regardless of scroll position */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            {isActivated && currentLicense.tier !== 'community' ? (
              <TierBadge tier={currentLicense.tier === 'studio' ? 'studio' : 'pro'} />
            ) : (
              <span className="text-sm font-semibold text-gray-100">Imagginary Pro</span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="overflow-y-auto flex-1">
          {isActivated ? (
            <ActivatedView
              license={currentLicense}
              onLicenseChange={onLicenseChange}
              onClose={onClose}
            />
          ) : (
            <CommunityView onLicenseChange={onLicenseChange} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
