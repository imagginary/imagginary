import React from 'react';
import { RefreshCw, Download, Zap } from 'lucide-react';
import { Panel, Character } from '../types';
import { FILM_DICTIONARY } from '../data/FilmLanguageDictionary';
import { ASPECT_RATIOS, DEFAULT_ASPECT_RATIO_ID, getAspectRatio } from '../data/AspectRatios';

interface RightSidebarProps {
  panel: Panel | null;
  characters: Character[];
  projectAspectRatioId?: string;
  onUpdatePanel: (updates: Partial<Panel>) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onExportPanel: () => void;
  isGenerating: boolean;
}

// Options sourced from FILM_DICTIONARY — single source of truth
const SHOT_TYPES = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'shot-type').map((t) => t.term))];
const ANGLES     = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'camera-angle').map((t) => t.term))];
const MOODS      = [...new Set(FILM_DICTIONARY.filter((t) => t.category === 'mood').map((t) => t.term))];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-800 pb-3 mb-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-2 px-3">
        {title}
      </div>
      <div className="px-3">{children}</div>
    </div>
  );
}

function SelectField({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string | null;
  options: string[];
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-imagginary-600 transition-colors"
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

export default function RightSidebar({
  panel,
  characters,
  projectAspectRatioId,
  onUpdatePanel,
  onGenerate,
  onRegenerate,
  onExportPanel,
  isGenerating,
}: RightSidebarProps) {
  if (!panel) {
    return (
      <div className="h-full flex items-center justify-center text-gray-700 text-xs px-4 text-center">
        Select a panel to edit shot details
      </div>
    );
  }

  function toggleCharacter(characterId: string) {
    if (!panel) return;
    const current = panel.characters ?? [];
    const updated = current.includes(characterId)
      ? current.filter((id) => id !== characterId)
      : [...current, characterId];
    onUpdatePanel({ characters: updated });
  }

  return (
    <div className="h-full overflow-y-auto py-3">
      {/* Shot Details */}
      <Section title="Shot Details">
        <p className="text-[10px] text-imagginary-600/80 mb-2">Set before generating — hints influence the AI prompt.</p>
        <div className="space-y-2">
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">Shot Type</label>
            <SelectField
              value={panel.shotType}
              options={SHOT_TYPES}
              onChange={(v) => onUpdatePanel({ shotType: v })}
              placeholder="Shot type"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">Camera Angle</label>
            <SelectField
              value={panel.angle}
              options={ANGLES}
              onChange={(v) => onUpdatePanel({ angle: v })}
              placeholder="Camera angle"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">Mood</label>
            <SelectField
              value={panel.mood}
              options={MOODS}
              onChange={(v) => onUpdatePanel({ mood: v })}
              placeholder="Mood"
            />
          </div>
        </div>
      </Section>

      {/* Characters in Shot */}
      <Section title="Characters in Shot">
        {characters.length === 0 ? (
          <p className="text-[10px] text-gray-700">No characters defined</p>
        ) : (
          <div className="space-y-1.5">
            {characters.map((char) => (
              <label key={char.id} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={panel.characters.includes(char.id)}
                  onChange={() => toggleCharacter(char.id)}
                  className="accent-imagginary-500 w-3 h-3 shrink-0"
                />
                {char.referenceImageData ? (
                  <img
                    src={char.referenceImageData}
                    alt={char.name}
                    className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-gray-700"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-gray-800 shrink-0" />
                )}
                <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors truncate">
                  {char.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </Section>

      {/* Duration */}
      <Section title="Duration">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={10}
            value={panel.duration}
            onChange={(e) => onUpdatePanel({ duration: Number(e.target.value) })}
            className="flex-1 accent-imagginary-500"
          />
          <span className="text-xs text-imagginary-400 font-mono w-8 text-right">{panel.duration}s</span>
        </div>
        <p className="text-[10px] text-gray-700 mt-1">Duration in animatic (seconds)</p>
      </Section>

      {/* Aspect Ratio */}
      <Section title="Aspect Ratio">
        <select
          value={panel.aspectRatioId ?? ''}
          onChange={(e) => onUpdatePanel({ aspectRatioId: e.target.value === '' ? null : e.target.value })}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-imagginary-600 transition-colors"
        >
          <option value="">
            Project default ({getAspectRatio(projectAspectRatioId ?? DEFAULT_ASPECT_RATIO_ID).label})
          </option>
          {ASPECT_RATIOS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} — {r.description.split('—')[0].trim()}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-gray-700 mt-1">Overrides project default for this panel only</p>
      </Section>

      {/* Director's Notes */}
      <Section title="Director's Notes">
        <textarea
          value={panel.notes}
          onChange={(e) => onUpdatePanel({ notes: e.target.value })}
          placeholder="Add notes for this shot..."
          rows={3}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-2 text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-imagginary-600 transition-colors resize-none"
        />
      </Section>

      {/* LLM Parsed Prompt */}
      {panel.structuredPrompt && (
        <Section title="Parsed Prompt">
          <div className="space-y-1.5 text-[10px]">
            {Object.entries(panel.structuredPrompt)
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-gray-600 w-20 shrink-0 capitalize">{key}:</span>
                  <span className="text-gray-400 break-words">{String(value)}</span>
                </div>
              ))}
          </div>
        </Section>
      )}

      {/* Actions */}
      <div className="px-3 space-y-2">
        <button
          onClick={onGenerate}
          disabled={isGenerating || !panel.shotDescription}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-imagginary-500 hover:bg-imagginary-400 disabled:bg-gray-900 disabled:text-gray-700 text-black text-xs font-semibold rounded transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          Generate
        </button>
        <button
          onClick={onRegenerate}
          disabled={isGenerating || !panel.shotDescription}
          className="w-full flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-700 text-gray-300 text-xs rounded transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerate
        </button>
        <button
          onClick={onExportPanel}
          disabled={!panel.generatedImageData}
          className="w-full flex items-center justify-center gap-2 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-700 text-gray-300 text-xs rounded transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export Panel
        </button>
      </div>
    </div>
  );
}
