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
  const total = CREDIT_POOLS[tier];
  const used = Math.max(0, total - subCredits);
  const pct = total > 0 ? (used / total) * 100 : 0;
  const barColor = pct < 50 ? 'bg-green-500' : pct < 80 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-2">
      <div className="w-full bg-gray-800 rounded-full h-1.5">
        <div
          className={`${barColor} h-1.5 rounded-full transition-all`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
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
