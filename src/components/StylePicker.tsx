import React, { useState } from 'react';
import { X, Palette, Lock } from 'lucide-react';
import { StyleProfile } from '../types';
import {
  STYLE_VAULT,
  PRO_STYLE_UNAVAILABLE_MESSAGE,
  STYLE_CHANGE_WARNING,
} from '../data/StyleVault';
import { ASPECT_RATIOS, DEFAULT_ASPECT_RATIO_ID } from '../data/AspectRatios';

interface StylePickerProps {
  currentStyle: StyleProfile;
  currentAspectRatioId?: string;
  onApply: (style: StyleProfile) => void;
  onApplyAspectRatio?: (id: string) => void;
  onClose: () => void;
}

export default function StylePicker({
  currentStyle,
  currentAspectRatioId,
  onApply,
  onApplyAspectRatio,
  onClose,
}: StylePickerProps) {
  const [selected, setSelected] = useState<StyleProfile>(currentStyle);
  const [selectedRatioId, setSelectedRatioId] = useState<string>(
    currentAspectRatioId ?? DEFAULT_ASPECT_RATIO_ID
  );
  const [proMessage, setProMessage] = useState<string | null>(null);

  function handleCardClick(style: StyleProfile) {
    setSelected(style);
    setProMessage(style.tier === 'pro' ? PRO_STYLE_UNAVAILABLE_MESSAGE : null);
  }

  function handleApply() {
    onApply(selected);
    onApplyAspectRatio?.(selectedRatioId);
    onClose();
  }

  const community = STYLE_VAULT.filter((s) => s.tier === 'community');
  const pro       = STYLE_VAULT.filter((s) => s.tier === 'pro');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95">
      <div className="w-full max-w-2xl mx-4 flex flex-col bg-gray-950 border border-gray-800 rounded-xl shadow-2xl max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Palette className="w-4 h-4 text-imagginary-400" />
            <span className="text-sm font-semibold text-gray-100">Style Vault</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 flex flex-col gap-5">

          {/* Community section */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-2.5">
              Community — all styles free
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {community.map((style) => (
                <StyleCard
                  key={style.id}
                  style={style}
                  isActive={selected.id === style.id}
                  onClick={() => handleCardClick(style)}
                />
              ))}
            </div>
          </div>

          {/* Pro section */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">Pro</p>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-imagginary-500/20 text-imagginary-400 border border-imagginary-500/30 uppercase tracking-wider">
                Coming soon
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {pro.map((style) => (
                <StyleCard
                  key={style.id}
                  style={style}
                  isActive={selected.id === style.id}
                  onClick={() => handleCardClick(style)}
                  isPro
                />
              ))}
            </div>
            {proMessage && (
              <p className="text-xs text-imagginary-500/80 mt-2.5 px-0.5">{proMessage}</p>
            )}
          </div>

          {/* Aspect Ratio */}
          <div className="border-t border-gray-800 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-2.5">
              Aspect Ratio
            </p>
            <div className="grid grid-cols-5 gap-2">
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio.id}
                  onClick={() => setSelectedRatioId(ratio.id)}
                  title={ratio.description}
                  className={`flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-lg border transition-all ${
                    selectedRatioId === ratio.id
                      ? 'border-imagginary-500 bg-imagginary-500/10'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-700'
                  }`}
                >
                  {/* Visual frame preview */}
                  <div className="flex items-center justify-center w-8 h-5">
                    <div
                      className={`border rounded-sm ${
                        selectedRatioId === ratio.id ? 'border-imagginary-400' : 'border-gray-600'
                      }`}
                      style={{
                        aspectRatio: ratio.cssRatio,
                        width: ratio.width > ratio.height ? '100%' : 'auto',
                        height: ratio.height >= ratio.width ? '100%' : 'auto',
                        maxWidth: '100%',
                        maxHeight: '100%',
                      }}
                    />
                  </div>
                  <span className={`text-[10px] font-semibold ${
                    selectedRatioId === ratio.id ? 'text-imagginary-400' : 'text-gray-300'
                  }`}>
                    {ratio.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 shrink-0">
          <p className="text-[11px] text-gray-600 max-w-xs">{STYLE_CHANGE_WARNING}</p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-1.5 rounded text-xs font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StyleCard({
  style,
  isActive,
  isPro = false,
  onClick,
}: {
  style: StyleProfile;
  isActive: boolean;
  isPro?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-all ${
        isActive
          ? 'border-imagginary-500 bg-imagginary-500/5'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={`text-xs font-semibold ${isActive ? 'text-imagginary-400' : 'text-gray-200'}`}>
          {style.name}
        </span>
        {isPro && (
          <Lock className="w-3 h-3 text-imagginary-500/60 shrink-0 mt-0.5" />
        )}
      </div>
      <p className="text-[10px] text-gray-500 leading-snug">{style.description}</p>
    </button>
  );
}
