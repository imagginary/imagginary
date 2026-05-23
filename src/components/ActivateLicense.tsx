/**
 * ActivateLicense — modal for Pro/Studio license activation.
 *
 * State A (community): pricing buttons → Dodo checkout, plus key input to activate.
 * State B (activated): shows tier, email, deactivate option.
 */

import React, { useState, useCallback } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Star, Zap, ExternalLink } from 'lucide-react';
import { License } from '../types';
import { licenseService } from '../services/LicenseService';

interface ActivateLicenseProps {
  currentLicense: License | null;
  onLicenseChange: () => void;
  onClose: () => void;
}

// ── Tier badge ────────────────────────────────────────────────────────────────

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

// ── State A — not activated ───────────────────────────────────────────────────

function CommunityView({ onLicenseChange, onClose }: { onLicenseChange: () => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      {/* Heading */}
      <div>
        <p className="text-base font-bold text-gray-100">Unlock Pro Features</p>
        <p className="text-xs text-gray-500 mt-1">
          Motion generation, voice synthesis, pose engine, revision history, and more.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Pro */}
        <div className="rounded-xl border border-imagginary-800/50 bg-imagginary-950/30 p-4 flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="w-3.5 h-3.5 text-imagginary-400" />
              <span className="text-xs font-bold text-imagginary-300 uppercase tracking-wide">Pro</span>
            </div>
            <p className="text-xl font-bold text-gray-100">$19<span className="text-sm font-normal text-gray-500">/mo</span></p>
          </div>
          <ul className="space-y-1 text-[11px] text-gray-400">
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Motion generation</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Voice synthesis</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Pose engine</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />8 library voices</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-imagginary-500 shrink-0 mt-px" />Revision history</li>
          </ul>
          <button
            onClick={() => licenseService.openCheckout('pro')}
            className="mt-auto flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Upgrade to Pro
          </button>
        </div>

        {/* Studio */}
        <div className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-4 flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Star className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs font-bold text-violet-300 uppercase tracking-wide">Studio</span>
            </div>
            <p className="text-xl font-bold text-gray-100">$79<span className="text-sm font-normal text-gray-500">/mo</span></p>
          </div>
          <ul className="space-y-1 text-[11px] text-gray-400">
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Everything in Pro</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />PDF storyboard export</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Premiere Pro XML</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Custom voice cloning</li>
            <li className="flex items-start gap-1.5"><CheckCircle className="w-3 h-3 text-violet-500 shrink-0 mt-px" />Priority support</li>
          </ul>
          <button
            onClick={() => licenseService.openCheckout('studio')}
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

// ── State B — activated ───────────────────────────────────────────────────────

function ActivatedView({ license, onLicenseChange, onClose }: {
  license: License;
  onLicenseChange: () => void;
  onClose: () => void;
}) {
  const [deactivating, setDeactivating] = useState(false);

  const handleDeactivate = useCallback(async () => {
    setDeactivating(true);
    await licenseService.deactivate();
    onLicenseChange();
    onClose();
  }, [onLicenseChange, onClose]);

  const isExpired = license.expiresAt !== null && Date.now() > license.expiresAt;
  const tier = license.tier === 'studio' ? 'studio' : 'pro';

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <CheckCircle className="w-10 h-10 text-green-400" />
        <div>
          <p className="text-sm font-bold text-gray-100 mb-2">License Active</p>
          <TierBadge tier={tier} />
        </div>
        <p className="text-xs text-gray-500">{license.email}</p>
        {license.expiresAt && (
          <p className={`text-[10px] ${isExpired ? 'text-red-400' : 'text-gray-600'}`}>
            {isExpired
              ? 'Expired — renew to continue using Pro features'
              : `Renews ${new Date(license.expiresAt).toLocaleDateString()}`}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <button
          onClick={() => licenseService.openCheckout(tier)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Manage Subscription
        </button>

        <button
          onClick={handleDeactivate}
          disabled={deactivating}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors"
        >
          {deactivating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {deactivating ? 'Deactivating…' : 'Deactivate license on this machine'}
        </button>
      </div>
    </div>
  );
}

// ── Main modal shell ──────────────────────────────────────────────────────────

export default function ActivateLicense({ currentLicense, onLicenseChange, onClose }: ActivateLicenseProps) {
  const isActivated = currentLicense !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
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
  );
}
