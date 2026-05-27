import React from 'react';
import { licenseService } from '../services/LicenseService';

interface Props {
  type: 'inpaints' | 'characterPanels' | 'lipSyncClips';
  label: string;
}

export default function CreditUsageBar({ type, label }: Props) {
  const tier = licenseService.getTier();
  if (tier === 'community') return null;

  const limit = licenseService.getLimit(type);
  const usage = licenseService.getUsage();
  const used = usage[type];
  const pct = Math.min((used / limit) * 100, 100);
  const daysUntilReset = Math.max(
    0,
    Math.ceil((usage.periodStart + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000))
  );

  const barColor = pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">{label}</span>
        <span className="text-[10px] text-gray-600 font-mono">{used} / {limit.toLocaleString()} used</span>
      </div>
      <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-gray-700">Resets in {daysUntilReset} day{daysUntilReset !== 1 ? 's' : ''}</p>
    </div>
  );
}
