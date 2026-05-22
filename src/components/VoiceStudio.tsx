/**
 * Phase 15 — VoiceStudio
 *
 * Modal for generating character dialogue audio via Coqui TTS.
 *
 * Flow:
 *   1. Auto-check if Coqui TTS is installed — show install prompt if not
 *   2. Voice library grid — 8 built-in profiles, filterable by style/gender
 *   3. Select voice → preview sample
 *   4. Pick character + write dialogue
 *   5. Generate → WAV output with inline playback + download
 *   Studio only: Upload 5-min sample to clone a custom voice
 *
 * Pro: library voices. Studio: custom cloning.
 * Community users see upgrade prompt.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Play, Pause, Download, Upload, Loader2, Mic, MicOff,
  CheckCircle, AlertCircle, Lock, Volume2, RefreshCw,
} from 'lucide-react';
import { Character, Panel } from '../types';
import { VoiceProfile, voiceService, CoquiCheckResult } from '../services/VoiceService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoiceStudioProps {
  panel: Panel;
  characters: Character[];
  isPro: boolean;
  isStudio?: boolean;
  onComplete: (wavPath: string, characterId: string | null) => void;
  onClose: () => void;
}

type InstallState = 'checking' | 'available' | 'not-installed' | 'installing' | 'failed';

// ── Style tag pill ────────────────────────────────────────────────────────────

function StyleTag({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-700 text-gray-400 uppercase tracking-wide">
      {label}
    </span>
  );
}

// ── Voice card ────────────────────────────────────────────────────────────────

function VoiceCard({
  profile,
  selected,
  onSelect,
  onPreview,
  isPreviewing,
}: {
  profile: VoiceProfile;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  isPreviewing: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className={`relative rounded-lg border p-3 cursor-pointer transition-all ${
        selected
          ? 'border-imagginary-500 bg-imagginary-900/20 ring-1 ring-imagginary-500/30'
          : 'border-gray-700 bg-gray-900 hover:border-gray-600 hover:bg-gray-800/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-100 truncate">{profile.name}</p>
          <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed line-clamp-2">{profile.description}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <StyleTag label={profile.style} />
            <StyleTag label={profile.gender} />
            <StyleTag label={profile.age} />
            {profile.accent !== 'american' && <StyleTag label={profile.accent} />}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          title="Preview voice sample"
        >
          {isPreviewing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </button>
      </div>
      {selected && (
        <div className="absolute top-1.5 right-10">
          <div className="w-2 h-2 rounded-full bg-imagginary-500" />
        </div>
      )}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-imagginary-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VoiceStudio({
  panel,
  characters,
  isPro,
  isStudio = false,
  onComplete,
  onClose,
}: VoiceStudioProps) {
  const [installState, setInstallState] = useState<InstallState>('checking');
  const [installProgress, setInstallProgress] = useState('');
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    panel.voiceCharacterId ?? (panel.characters[0] ?? null),
  );
  const [dialogue, setDialogue] = useState('');
  const [genState, setGenState] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [genProgress, setGenProgress] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedWavPath, setGeneratedWavPath] = useState<string | null>(panel.voicePath ?? null);
  const [isPlayingResult, setIsPlayingResult] = useState(false);
  // Studio: voice cloning
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);

  // ── Boot: check Coqui TTS availability ─────────────────────────────────────

  useEffect(() => {
    voiceService.checkCoquiTTS().then((res: CoquiCheckResult) => {
      setInstallState(res.available ? 'available' : 'not-installed');
    });
  }, []);

  // ── Load voice library once Coqui is available ──────────────────────────────

  useEffect(() => {
    if (installState !== 'available') return;
    voiceService.getAvailableVoices().then((v) => {
      setVoices(v);
      if (v.length > 0 && !selectedVoiceId) setSelectedVoiceId(v[0].id);
    });
  }, [installState]);

  // ── Cleanup audio on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      previewAudioRef.current?.pause();
    };
  }, []);

  // ── Install ─────────────────────────────────────────────────────────────────

  const handleInstall = useCallback(async () => {
    setInstallState('installing');
    setInstallProgress('Starting install…');
    const ok = await voiceService.installCoquiTTS((msg) => setInstallProgress(msg));
    if (ok) {
      setInstallState('available');
    } else {
      setInstallState('failed');
    }
  }, []);

  // ── Preview sample ──────────────────────────────────────────────────────────

  const handlePreview = useCallback(async (voiceId: string) => {
    if (previewingId === voiceId) {
      previewAudioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    try {
      previewAudioRef.current?.pause();
      const samplePath = await voiceService.previewVoice(voiceId);
      const audio = new Audio(`file://${samplePath}`);
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewingId(null);
      audio.play();
      setPreviewingId(voiceId);
    } catch {
      // sample not available yet — silently ignore
    }
  }, [previewingId]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!selectedVoiceId || !dialogue.trim()) return;
    const profile = voices.find((v) => v.id === selectedVoiceId);
    if (!profile) return;

    setGenState('generating');
    setGenProgress(0);
    setGenError(null);

    try {
      const wavPath = await voiceService.generateVoice(
        dialogue.trim(),
        selectedVoiceId,
        profile,
        (pct) => setGenProgress(pct),
      );
      setGeneratedWavPath(wavPath);
      setGenState('done');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed');
      setGenState('error');
    }
  }, [selectedVoiceId, dialogue, voices]);

  // ── Playback ─────────────────────────────────────────────────────────────────

  const handlePlayResult = useCallback(() => {
    if (!generatedWavPath) return;
    if (isPlayingResult) {
      audioRef.current?.pause();
      setIsPlayingResult(false);
      return;
    }
    const audio = new Audio(`file://${generatedWavPath}`);
    audioRef.current = audio;
    audio.onended = () => setIsPlayingResult(false);
    audio.play();
    setIsPlayingResult(true);
  }, [generatedWavPath, isPlayingResult]);

  const handleDownload = useCallback(() => {
    if (!generatedWavPath) return;
    const a = document.createElement('a');
    a.href = `file://${generatedWavPath}`;
    a.download = `voice_${selectedVoiceId ?? 'output'}.wav`;
    a.click();
  }, [generatedWavPath, selectedVoiceId]);

  const handleConfirm = useCallback(() => {
    if (!generatedWavPath) return;
    onComplete(generatedWavPath, selectedCharacterId);
  }, [generatedWavPath, selectedCharacterId, onComplete]);

  // ── Voice clone ──────────────────────────────────────────────────────────────

  const handleClone = useCallback(async () => {
    if (!cloneFile || !cloneName.trim()) return;
    setIsCloning(true);
    setCloneError(null);
    try {
      const profile = await voiceService.cloneVoice(cloneFile.path ?? cloneFile.name, cloneName.trim());
      setVoices((prev) => [...prev, profile]);
      setSelectedVoiceId(profile.id);
      setCloneFile(null);
      setCloneName('');
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : 'Cloning failed');
    } finally {
      setIsCloning(false);
    }
  }, [cloneFile, cloneName]);

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) ?? null;

  // ── Community gate ───────────────────────────────────────────────────────────

  if (!isPro) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-sm w-full mx-4 text-center">
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
          <Lock className="w-10 h-10 text-imagginary-500/60 mx-auto mb-4" />
          <p className="text-base font-semibold text-gray-100 mb-2">Voice Studio — Pro Feature</p>
          <p className="text-sm text-gray-500 mb-6">
            Generate character dialogue audio with 8 professional voice profiles.
            Custom voice cloning available on Studio.
          </p>
          <button className="px-5 py-2.5 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors">
            Upgrade to Pro — $19/month
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-imagginary-400" />
            <span className="text-sm font-semibold text-gray-100">Voice Studio</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-imagginary-900/40 text-imagginary-400 border border-imagginary-800/40 font-medium uppercase tracking-wide">
              Pro
            </span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── Install prompt ──────────────────────────────────────────────── */}
          {installState === 'checking' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
              <p className="text-sm text-gray-500">Checking Coqui TTS…</p>
            </div>
          )}

          {installState === 'not-installed' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
              <MicOff className="w-10 h-10 text-gray-600" />
              <p className="text-sm font-semibold text-gray-200">Coqui TTS not installed</p>
              <p className="text-xs text-gray-500 text-center max-w-sm">
                Voice generation requires Coqui TTS (~500 MB). It installs into the existing
                ComfyUI Python environment — no separate Python needed.
              </p>
              <button
                onClick={handleInstall}
                className="px-5 py-2.5 bg-imagginary-600 hover:bg-imagginary-500 text-black text-sm font-semibold rounded-lg transition-colors"
              >
                Install Coqui TTS (~500 MB)
              </button>
            </div>
          )}

          {installState === 'installing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-8">
              <Loader2 className="w-6 h-6 text-imagginary-400 animate-spin" />
              <p className="text-sm font-medium text-gray-200">Installing Coqui TTS…</p>
              <p className="text-xs text-gray-500 font-mono text-center max-w-md">{installProgress}</p>
            </div>
          )}

          {installState === 'failed' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <p className="text-sm font-semibold text-gray-200">Install failed</p>
              <p className="text-xs text-gray-500 text-center max-w-sm">
                Run{' '}
                <code className="font-mono bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">pip install TTS</code>
                {' '}in your ComfyUI Python environment, then reopen Voice Studio.
              </p>
              <button onClick={handleInstall} className="flex items-center gap-1.5 text-xs text-imagginary-400 hover:text-imagginary-300">
                <RefreshCw className="w-3 h-3" /> Try again
              </button>
            </div>
          )}

          {/* ── Main UI (Coqui available) ───────────────────────────────────── */}
          {installState === 'available' && (
            <div className="p-5 space-y-5">

              {/* Voice library grid */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Voice Library</p>
                {voices.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {voices.map((v) => (
                      <VoiceCard
                        key={v.id}
                        profile={v}
                        selected={selectedVoiceId === v.id}
                        onSelect={() => setSelectedVoiceId(v.id)}
                        onPreview={() => handlePreview(v.id)}
                        isPreviewing={previewingId === v.id}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Character + dialogue */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Dialogue</p>

                {/* Character selector */}
                {characters.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 shrink-0">Speaking character</label>
                    <select
                      value={selectedCharacterId ?? ''}
                      onChange={(e) => setSelectedCharacterId(e.target.value || null)}
                      className="flex-1 bg-gray-800 border border-gray-700 focus:border-imagginary-500 rounded px-2.5 py-1.5 text-xs text-gray-200 outline-none"
                    >
                      <option value="">— no character —</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Dialogue textarea */}
                <textarea
                  value={dialogue}
                  onChange={(e) => setDialogue(e.target.value)}
                  placeholder="Write dialogue for this character…"
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-imagginary-500 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none resize-none transition-colors"
                />

                {/* Generate button */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleGenerate}
                    disabled={!selectedVoiceId || !dialogue.trim() || genState === 'generating'}
                    className="flex items-center gap-2 px-4 py-2 bg-imagginary-600 hover:bg-imagginary-500 text-black text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {genState === 'generating' ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                    ) : (
                      <><Volume2 className="w-3 h-3" /> Generate Voice</>
                    )}
                  </button>

                  {selectedVoice && (
                    <p className="text-[10px] text-gray-600">
                      Using: <span className="text-gray-400">{selectedVoice.name}</span>
                    </p>
                  )}
                </div>

                {/* Generation progress */}
                {genState === 'generating' && (
                  <ProgressBar pct={genProgress} label="Synthesising speech…" />
                )}

                {/* Error */}
                {genState === 'error' && genError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-950/30 border border-red-800/40">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{genError}</p>
                  </div>
                )}
              </div>

              {/* Generated result */}
              {generatedWavPath && genState === 'done' && (
                <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <p className="text-xs font-semibold text-gray-200">Voice generated</p>
                  </div>
                  <p className="text-[10px] text-gray-600 font-mono truncate">{generatedWavPath}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePlayResult}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      {isPlayingResult ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Play</>}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      <Download className="w-3 h-3" /> Download WAV
                    </button>
                    <button
                      onClick={handleConfirm}
                      className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors"
                    >
                      <CheckCircle className="w-3 h-3" /> Save to Panel
                    </button>
                  </div>
                </div>
              )}

              {/* Studio: Voice cloning */}
              {isStudio && (
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Custom Voice Clone</p>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-violet-900/30 text-violet-400 border border-violet-800/30 font-medium uppercase">Studio</span>
                  </div>
                  <p className="text-[10px] text-gray-600">
                    Upload a 5-minute minimum audio sample to fine-tune a custom voice.
                  </p>

                  <input
                    ref={cloneInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => setCloneFile(e.target.files?.[0] ?? null)}
                  />

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => cloneInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
                    >
                      <Upload className="w-3 h-3" />
                      {cloneFile ? cloneFile.name : 'Upload Voice Sample'}
                    </button>

                    {cloneFile && (
                      <>
                        <input
                          type="text"
                          value={cloneName}
                          onChange={(e) => setCloneName(e.target.value)}
                          placeholder="Voice name…"
                          className="flex-1 bg-gray-800 border border-gray-700 focus:border-imagginary-500 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none"
                        />
                        <button
                          onClick={handleClone}
                          disabled={!cloneName.trim() || isCloning}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {isCloning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                          {isCloning ? 'Cloning…' : 'Clone Voice'}
                        </button>
                      </>
                    )}
                  </div>

                  {cloneError && (
                    <p className="text-[10px] text-red-400">{cloneError}</p>
                  )}
                </div>
              )}

              {/* S2V lip sync placeholder */}
              <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/30 p-4 text-center space-y-1.5">
                <p className="text-xs font-semibold text-gray-600">Lip Sync — Coming Soon</p>
                <p className="text-[10px] text-gray-700">
                  Wan 2.2 S2V lip sync will animate your storyboard panels to match the generated audio.
                  Pending GPU validation on RunPod.
                </p>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
