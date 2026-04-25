import React, { useState, useRef } from 'react';
import { X, ScrollText, ChevronLeft, Loader2, AlertCircle } from 'lucide-react';
import { ScriptShot, Character } from '../types';
import { ollamaService } from '../services/OllamaService';
import ScriptShotCard from './ScriptShotCard';

type ReaderState = 'input' | 'parsing' | 'preview' | 'generating';

interface ScriptReaderProps {
  characters: Character[];
  isOllamaConnected: boolean;
  onGenerate: (shots: ScriptShot[], onProgress: (current: number, total: number) => void) => Promise<void>;
  onClose: () => void;
}

const EXAMPLE_HINT = `Accepts: INT./EXT. screenplay format · Fountain · plain prose description`;

const EXAMPLE_SCRIPT = `INT. POLICE INTERROGATION ROOM - NIGHT

A single bulb hangs over a steel table. DETECTIVE KANE, 50s, sits opposite
a nervous SUSPECT who won't meet his eyes.

KANE
(quietly)
We found the money, Marcus. All of it.

The suspect's hands tighten on the table edge.`;

export default function ScriptReader({
  characters,
  isOllamaConnected,
  onGenerate,
  onClose,
}: ScriptReaderProps) {
  const [readerState, setReaderState] = useState<ReaderState>('input');
  const [scriptText, setScriptText] = useState('');
  const [shots, setShots] = useState<ScriptShot[]>([]);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // ── Parsing ──────────────────────────────────────────────────────────────────

  async function handleParseScript() {
    if (!scriptText.trim()) return;
    setError(null);
    setReaderState('parsing');

    try {
      // Run parse and character extraction in parallel
      const [parsedShots, extractedNames] = await Promise.all([
        ollamaService.parseScreenplay(scriptText),
        ollamaService.extractCharacterNames(scriptText),
      ]);

      // Merge extracted names into per-shot characterNames (deduplicated)
      const allNames = new Set(extractedNames.map((n) => n.toLowerCase()));

      // Match character names against project characters case-insensitively
      const withAssigned: ScriptShot[] = parsedShots.map((shot) => {
        // Combine per-shot names with any from the global extraction that match this shot's text
        const shotText = shot.shotDescription.toLowerCase();
        const mergedNames = [...new Set([
          ...shot.characterNames,
          ...extractedNames.filter((n) => allNames.has(n.toLowerCase()) && shotText.includes(n.toLowerCase())),
        ])];

        const assignedCharacterIds = characters
          .filter((c) => mergedNames.some((n) => n.toLowerCase() === c.name.toLowerCase()))
          .map((c) => c.id);

        return { ...shot, characterNames: mergedNames, assignedCharacterIds };
      });

      setShots(withAssigned);
      setReaderState('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parsing failed');
      setReaderState('input');
    }
  }

  // ── Shot editing ──────────────────────────────────────────────────────────────

  function updateShot(index: number, updated: ScriptShot) {
    setShots((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }

  function removeShot(index: number) {
    setShots((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })));
  }

  function moveShot(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= shots.length) return;
    const next = [...shots];
    [next[index], next[target]] = [next[target], next[index]];
    setShots(next.map((s, i) => ({ ...s, order: i + 1 })));
  }

  // ── Generation ────────────────────────────────────────────────────────────────

  async function handleGenerateAll() {
    if (shots.length === 0) return;
    cancelledRef.current = false;
    setReaderState('generating');
    setGenProgress({ current: 0, total: shots.length });
    setError(null);

    try {
      await onGenerate(shots, (current, total) => {
        if (!cancelledRef.current) setGenProgress({ current, total });
      });
      // onGenerate resolves when all panels are generated — close modal
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setReaderState('preview');
      setGenProgress(null);
    }
  }

  // ── Cancel handling ───────────────────────────────────────────────────────────

  function handleCancel() {
    if (readerState === 'generating') {
      if (!window.confirm('Generation is in progress. Close the Script Reader? (Panels will continue generating in the background.)')) return;
      cancelledRef.current = true;
    }
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95">
      <div className="w-full max-w-2xl mx-4 flex flex-col bg-gray-950 border border-gray-800 rounded-xl shadow-2xl max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <ScrollText className="w-4 h-4 text-imagginary-400" />
            <span className="text-sm font-semibold text-gray-100">Script Reader</span>
            {readerState === 'preview' && (
              <span className="text-xs text-gray-500 ml-1">— {shots.length} shot{shots.length !== 1 ? 's' : ''} detected</span>
            )}
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">

          {/* ── State: input ── */}
          {(readerState === 'input' || readerState === 'parsing') && (
            <div className="flex flex-col gap-3">
              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-950/60 border border-red-800/50 rounded-lg text-sm text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <textarea
                rows={14}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder={EXAMPLE_SCRIPT}
                disabled={readerState === 'parsing'}
                className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-700 outline-none transition-colors resize-none font-mono leading-relaxed disabled:opacity-50"
              />

              <p className="text-[11px] text-gray-600">{EXAMPLE_HINT}</p>
            </div>
          )}

          {/* ── State: parsing spinner ── */}
          {readerState === 'parsing' && (
            <div className="flex items-center gap-3 mt-4 px-1">
              <Loader2 className="w-4 h-4 text-imagginary-400 animate-spin shrink-0" />
              <span className="text-sm text-gray-400">Analysing script with Ollama…</span>
            </div>
          )}

          {/* ── State: preview ── */}
          {(readerState === 'preview' || readerState === 'generating') && (
            <div className="flex flex-col gap-2.5">
              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-950/60 border border-red-800/50 rounded-lg text-sm text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {shots.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No shots detected. Go back and refine your script.</p>
              ) : (
                shots.map((shot, i) => (
                  <ScriptShotCard
                    key={`${shot.order}-${i}`}
                    shot={shot}
                    index={i}
                    total={shots.length}
                    characters={characters}
                    onChange={(updated) => updateShot(i, updated)}
                    onRemove={() => removeShot(i)}
                    onMoveUp={() => moveShot(i, -1)}
                    onMoveDown={() => moveShot(i, 1)}
                  />
                ))
              )}

              {/* Generation progress overlay */}
              {readerState === 'generating' && genProgress && (
                <div className="sticky bottom-0 bg-gray-950/90 border border-gray-800 rounded-lg px-4 py-3 flex flex-col gap-2 mt-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-gray-300">
                      <Loader2 className="w-3.5 h-3.5 text-imagginary-400 animate-spin" />
                      <span>Generating panel {genProgress.current} of {genProgress.total}…</span>
                    </div>
                    <span className="text-gray-600 font-mono">
                      {Math.round((genProgress.current / genProgress.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-imagginary-500 rounded-full transition-all duration-300"
                      style={{ width: `${(genProgress.current / genProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 shrink-0">
          {/* Left — back button (preview only) */}
          <div>
            {readerState === 'preview' && (
              <button
                onClick={() => setReaderState('input')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
          </div>

          {/* Right — primary action + cancel */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              disabled={readerState === 'parsing'}
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-30"
            >
              Cancel
            </button>

            {(readerState === 'input' || readerState === 'parsing') && (
              <button
                onClick={handleParseScript}
                disabled={!scriptText.trim() || readerState === 'parsing' || !isOllamaConnected}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={!isOllamaConnected ? 'Ollama must be running to parse scripts' : undefined}
              >
                {readerState === 'parsing' ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing…</>
                ) : (
                  <>Parse Script</>
                )}
              </button>
            )}

            {(readerState === 'preview' || readerState === 'generating') && (
              <button
                onClick={handleGenerateAll}
                disabled={shots.length === 0 || readerState === 'generating'}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {readerState === 'generating' ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                ) : (
                  <>Generate All Panels</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
