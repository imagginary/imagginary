import React from 'react';
import { licenseService, CREDIT_COSTS, CREDIT_POOLS } from '../services/LicenseService';

interface Props {
  showCosts?: boolean;
}

export function CreditUsageBar({ showCosts = false }: Props) {
  const tier = licenseService.getTier();
  if (tier === 'community') return null;

  const balance = licenseService.getBalance();
  const subCredits = balance.subscriptionCredits;
  const topUpCredits = balance.topUpCredits;
  // Total allotted = monthly pool + any top-up credits purchased
  const monthlyPool = CREDIT_POOLS[tier];
  const totalAllotted = monthlyPool + topUpCredits;
  // Remaining = what the user still has across both pools
  const totalRemaining = subCredits + topUpCredits;
  // Percentage for colour-coded urgency uses subscription pool only (top-ups are a bonus)
  const subPct = monthlyPool > 0 ? Math.min(100, ((monthlyPool - subCredits) / monthlyPool) * 100) : 0;
  const urgencyColor = subPct < 50 ? 'bg-green-500' : subPct < 80 ? 'bg-amber-500' : 'bg-red-500';
  // Segment widths as fractions of the combined allotment
  const subPctOfTotal = totalAllotted > 0 ? Math.min(100, (subCredits / totalAllotted) * 100) : 0;
  const topUpPctOfTotal = totalAllotted > 0 ? Math.min(100, (topUpCredits / totalAllotted) * 100) : 0;

  return (
    <div className="space-y-2">
      {/* Two-segment bar: violet = remaining sub credits, amber = remaining top-up credits */}
      <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden flex">
        <div
          className={`${urgencyColor} h-full transition-all`}
          style={{ width: `${subPctOfTotal}%` }}
          title={`${subCredits} subscription credits remaining`}
        />
        {topUpCredits > 0 && (
          <div
            className="bg-amber-500 h-full transition-all"
            style={{ width: `${topUpPctOfTotal}%` }}
            title={`${topUpCredits} top-up credits remaining`}
          />
        )}
      </div>
      <p className="text-[9px] text-gray-600">
        {totalRemaining} of {totalAllotted} credits remaining
        {topUpCredits > 0 && (
          <span className="text-amber-600/70"> · {topUpCredits} top-up</span>
        )}
      </p>
      {showCosts && (
        <div className="space-y-1 pt-1">
          <p className="text-[9px] text-gray-600 font-medium uppercase tracking-wide">Cost per action</p>
          {(
            [
              ['Panel (cloud)',    CREDIT_COSTS.panelCloud],
              ["Director's Eye",  CREDIT_COSTS.inpaint],
              ['Character panel', CREDIT_COSTS.characterPanel],
              ['Motion clip',     CREDIT_COSTS.motionClip],
              ['Lip sync',        CREDIT_COSTS.lipSync],
              ['Turntable 3D',    CREDIT_COSTS.turntable],
            ] as [string, number][]
          ).map(([label, cost]) => (
            <div key={label} className="flex justify-between text-[9px]">
              <span className="text-gray-600">{label}</span>
              <span className="text-gray-500">{cost} credits</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CreditUsageBar;
