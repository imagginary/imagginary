import React, { useRef, useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertCircle, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import { ServiceStatus } from '../types';
import { FILM_DICTIONARY } from '../data/FilmLanguageDictionary';

// Options from FILM_DICTIONARY — single source of truth
const SHOT_TYPE_OPTIONS = FILM_DICTIONARY.filter((t) => t.category === 'shot-type').map((t) => t.term);
const ANGLE_OPTIONS     = FILM_DICTIONARY.filter((t) => t.category === 'camera-angle').map((t) => t.term);
const MOOD_OPTIONS      = FILM_DICTIONARY.filter((t) => t.category === 'mood').map((t) => t.term);

export interface ShotConstraints {
  shotType: string;
  angle: string;
  mood: string;
}

interface ShotInputProps {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onOptionsChange: (opts: ShotConstraints) => void;
  isGenerating: boolean;
  serviceStatus: ServiceStatus;
  disabled: boolean;
}

function ConstraintSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 outline-none focus:border-imagginary-600 transition-colors"
      >
        <option value="">— any —</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ShotInput({
  value,
  onChange,
  onGenerate,
  onOptionsChange,
  isGenerating,
  serviceStatus,
  disabled,
}: ShotInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [shotType, setShotType] = useState('');
  const [angle, setAngle]       = useState('');
  const [mood, setMood]         = useState('');

  useEffect(() => {
    if (!isGenerating) inputRef.current?.focus();
  }, [isGenerating]);

  // Notify parent whenever any constraint changes
  function updateShotType(v: string) { setShotType(v); onOptionsChange({ shotType: v, angle, mood }); }
  function updateAngle(v: string)    { setAngle(v);    onOptionsChange({ shotType, angle: v, mood }); }
  function updateMood(v: string)     { setMood(v);     onOptionsChange({ shotType, angle, mood: v }); }

  const constraintsSet = shotType || angle || mood;

  const comfyOffline  = serviceStatus.comfyui === 'disconnected' || serviceStatus.comfyui === 'error';
  const ollamaOffline = serviceStatus.ollama  === 'disconnected' || serviceStatus.ollama  === 'error';
  const canGenerate   = !isGenerating && !disabled && !ollamaOffline && value.trim().length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && canGenerate) onGenerate();
  }

  return (
    <div className="px-6 py-4 border-t border-gray-800 bg-gray-950/80">
      {/* Warning banners */}
      {ollamaOffline && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-950/40 border border-red-800/40 rounded text-xs text-red-400">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          Ollama is not running. Start Ollama to enable shot parsing.
        </div>
      )}
      {comfyOffline && !ollamaOffline && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-imagginary-950/30 border border-imagginary-800/30 rounded text-xs text-imagginary-500">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          ComfyUI offline — prompts will be parsed but images queued until ComfyUI starts on port 8188.
        </div>
      )}

      <div className="flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating || ollamaOffline}
          placeholder="Describe a shot... e.g. A detective stands in a rain-soaked alley at midnight, low angle, film noir"
          className="flex-1 bg-gray-900 border border-gray-700 focus:border-imagginary-600 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          className="flex items-center gap-2 px-5 py-3 bg-imagginary-600 hover:bg-imagginary-500 disabled:bg-gray-800 disabled:text-gray-600 text-black font-semibold text-sm rounded-lg transition-colors"
          title={ollamaOffline ? 'Ollama required' : comfyOffline ? 'ComfyUI offline — will queue' : 'Generate panel (Enter)'}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Generate</span>
            </>
          )}
        </button>
      </div>

      {/* Options toggle row */}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[10px] text-gray-700">
          Press Enter to generate · Describe shot type, subject, setting, mood, lighting
        </p>
        <button
          onClick={() => setOptionsOpen((o) => !o)}
          className={`flex items-center gap-1 text-[10px] transition-colors ${
            constraintsSet ? 'text-imagginary-500 hover:text-imagginary-400' : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          {optionsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {constraintsSet ? 'Options set' : '+ Options'}
        </button>
      </div>

      {/* Expandable constraints row */}
      {optionsOpen && (
        <div className="mt-2.5 flex gap-2 items-end">
          <ConstraintSelect
            label="Shot Type"
            value={shotType}
            options={SHOT_TYPE_OPTIONS}
            onChange={updateShotType}
          />
          <ConstraintSelect
            label="Camera Angle"
            value={angle}
            options={ANGLE_OPTIONS}
            onChange={updateAngle}
          />
          <ConstraintSelect
            label="Mood"
            value={mood}
            options={MOOD_OPTIONS}
            onChange={updateMood}
          />
        </div>
      )}
    </div>
  );
}
