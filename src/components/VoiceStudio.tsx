/**
 * Phase 15 — VoiceStudio (edge-tts)
 *
 * Modal for generating character dialogue audio via edge-tts.
 *
 * Flow:
 *   1. Auto-check if edge-tts is installed — show install prompt if not
 *   2. Featured voices grid — 11 curated profiles (multilingual)
 *   3. "Browse all voices" expands the full ~320-voice catalogue with
 *      search, language filter, gender filter, and live preview
 *   4. Select voice → write dialogue → Generate → WAV output
 *   Studio only: Voice cloning panel
 *
 * Pro: all library voices. Studio: custom cloning. Community: upgrade gate.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Play, Pause, Download, Upload, Loader2, Mic, MicOff,
  CheckCircle, AlertCircle, Lock, Volume2, RefreshCw, Globe, ChevronDown, ChevronUp, Search, Trash2,
} from 'lucide-react';
import { Character, Panel } from '../types';
import { VoiceProfile, EdgeVoice, voiceService, EdgeTtsCheckResult } from '../services/VoiceService';
import { lipSyncService } from '../services/LipSyncService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoiceStudioProps {
  panel: Panel;
  characters: Character[];
  isPro: boolean;
  isStudio?: boolean;
  /** App-level lock — true when this panel's voice is generating (survives modal remount) */
  isVoiceGenerating?: boolean;
  onComplete: (wavPath: string, characterId: string | null) => void;
  onLipSyncComplete: (videoUrl: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onVoiceGenerationStart?: (panelId: string) => void;
  onVoiceGenerationEnd?: (panelId: string) => void;
}

type InstallState = 'checking' | 'available' | 'not-installed' | 'installing' | 'failed';

// ── Language grouping ─────────────────────────────────────────────────────────

const LANG_GROUPS: Record<string, string[]> = {
  'English': ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN', 'en-IE', 'en-NZ', 'en-ZA', 'en-HK', 'en-SG', 'en-PH', 'en-KE', 'en-NG', 'en-TZ'],
  'Indian Languages': ['hi-IN', 'ta-IN', 'te-IN', 'ml-IN', 'kn-IN', 'mr-IN', 'gu-IN', 'bn-IN', 'ur-IN'],
  'European': ['de-DE', 'de-AT', 'de-CH', 'fr-FR', 'fr-BE', 'fr-CA', 'fr-CH', 'es-ES', 'es-MX', 'es-US', 'it-IT', 'pt-BR', 'pt-PT', 'nl-NL', 'nl-BE', 'pl-PL', 'ru-RU', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'cs-CZ', 'ro-RO', 'sk-SK', 'hu-HU', 'hr-HR', 'uk-UA', 'bg-BG', 'el-GR', 'tr-TR', 'ca-ES'],
  'Asian': ['zh-CN', 'zh-HK', 'zh-TW', 'ja-JP', 'ko-KR', 'id-ID', 'th-TH', 'vi-VN', 'ms-MY', 'fil-PH'],
  'Middle East & Africa': ['ar-SA', 'ar-EG', 'ar-AE', 'he-IL', 'fa-IR', 'ur-PK', 'sw-KE', 'af-ZA', 'am-ET', 'so-SO'],
  'Other': [],
};

function getLocaleGroup(locale: string): string {
  for (const [group, locales] of Object.entries(LANG_GROUPS)) {
    if (group === 'Other') continue;
    if (locales.some((l) => locale.startsWith(l.split('-').slice(0, 2).join('-')))) return group;
  }
  return 'Other';
}

// ── Helper: flag emoji from locale ───────────────────────────────────────────

function localeFlag(locale: string): string {
  const country = locale.split('-')[1] ?? '';
  if (!country || country.length !== 2) return '🌐';
  return country.toUpperCase().replace(/./g, (c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1a5));
}

// ── Style tag pill ────────────────────────────────────────────────────────────

function Tag({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-700 text-gray-400 uppercase tracking-wide">
      {label}
    </span>
  );
}

// ── Featured voice card ───────────────────────────────────────────────────────

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
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{localeFlag(profile.language)}</span>
            <p className="text-xs font-semibold text-gray-100 truncate">{profile.name}</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed line-clamp-2">{profile.description}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Tag label={profile.gender} />
            <Tag label={profile.language} />
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          title="Preview voice"
        >
          {isPreviewing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </button>
      </div>
      {selected && <div className="absolute top-1.5 right-10 w-2 h-2 rounded-full bg-imagginary-500" />}
    </div>
  );
}

// ── Browser voice row ─────────────────────────────────────────────────────────

function BrowserRow({
  voice,
  isSelected,
  isPreviewing,
  onSelect,
  onPreview,
}: {
  voice: EdgeVoice;
  isSelected: boolean;
  isPreviewing: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer ${
      isSelected ? 'border-imagginary-500/60 bg-imagginary-900/15' : 'border-transparent hover:bg-gray-800/50'
    }`} onClick={onSelect}>
      <span className="text-base shrink-0">{localeFlag(voice.locale)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-200 truncate">{voice.name}</p>
        <p className="text-[10px] text-gray-600">{voice.locale} · {voice.gender}</p>
      </div>
      {isSelected && <CheckCircle className="w-3.5 h-3.5 text-imagginary-400 shrink-0" />}
      <button
        onClick={(e) => { e.stopPropagation(); onPreview(); }}
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        title="Preview"
      >
        {isPreviewing ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
      </button>
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
        <div className="h-full rounded-full bg-imagginary-500 transition-all duration-300" style={{ width: `${pct}%` }} />
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
  isVoiceGenerating = false,
  onComplete,
  onLipSyncComplete,
  onOpenSettings,
  onClose,
  onVoiceGenerationStart,
  onVoiceGenerationEnd,
}: VoiceStudioProps) {
  const [installState, setInstallState] = useState<InstallState>('checking');
  const [installProgress, setInstallProgress] = useState('');

  // Featured voices (from index.json)
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  // Tracks which edgeVoice name is "active" for generation (may come from browser)
  const [activeEdgeVoice, setActiveEdgeVoice] = useState<string | null>(null);
  const [activeVoiceLabel, setActiveVoiceLabel] = useState<string>('');

  const [previewingId, setPreviewingId] = useState<string | null>(null); // voice name or profile id

  // Voice browser
  const [showBrowser, setShowBrowser] = useState(false);
  const [allVoices, setAllVoices] = useState<EdgeVoice[]>([]);
  const [browserSearch, setBrowserSearch] = useState('');
  const [browserLang, setBrowserLang] = useState('All');
  const [browserGender, setBrowserGender] = useState('All');

  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    panel.voiceCharacterId ?? (panel.characters[0] ?? null),
  );
  const [dialogue, setDialogue] = useState('');
  const [genState, setGenState] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [genProgress, setGenProgress] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedWavPath, setGeneratedWavPath] = useState<string | null>(panel.voicePath ?? null);
  const [isPlayingResult, setIsPlayingResult] = useState(false);

  // Active voice profile (full object for generate routing)
  const [activeVoiceProfile, setActiveVoiceProfile] = useState<VoiceProfile | null>(null);

  // Studio: voice cloning
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneProvider, setCloneProvider] = useState<'cartesia' | 'elevenlabs' | null>(null);
  const [cloneAvailable, setCloneAvailable] = useState(true);

  // Lip sync
  const [lipSyncAvailable, setLipSyncAvailable] = useState(false);
  const [isGeneratingLipSync, setIsGeneratingLipSync] = useState(false);
  const [lipSyncProgress, setLipSyncProgress] = useState({ pct: 0, message: '' });
  const [lipSyncError, setLipSyncError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);

  // ── Boot ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    voiceService.checkCoquiTTS().then((res: EdgeTtsCheckResult) => {
      setInstallState(res.available ? 'available' : 'not-installed');
    });
    lipSyncService.isAvailable().then(setLipSyncAvailable);
    (window as any).electronAPI?.checkVoiceCloneProviders?.().then((r: any) => {
      setCloneProvider(r?.preferred ?? null);
      setCloneAvailable(!!r?.preferred);
    });
  }, []);

  useEffect(() => {
    if (installState !== 'available') return;
    voiceService.getAvailableVoices().then(async (v) => {
      // Merge persisted custom voices
      const customResult = await (window as any).electronAPI?.getCustomVoices?.();
      const customVoices: VoiceProfile[] = customResult?.voices ?? [];
      const existingIds = new Set(v.map((p: VoiceProfile) => p.id));
      const merged = [...v, ...customVoices.filter(c => !existingIds.has(c.id))];
      setVoices(merged);
      if (merged.length > 0 && !selectedVoiceId) {
        setSelectedVoiceId(merged[0].id);
        setActiveEdgeVoice(merged[0].edgeVoice);
        setActiveVoiceLabel(merged[0].name);
        setActiveVoiceProfile(merged[0]);
      }
    });
  }, [installState]);

  // Load full catalogue when browser opens for the first time
  useEffect(() => {
    if (showBrowser && allVoices.length === 0) {
      voiceService.getAllEdgeVoices().then(setAllVoices);
    }
  }, [showBrowser]);

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
    setInstallState(ok ? 'available' : 'failed');
  }, []);

  // ── Preview any edge-tts voice by name ─────────────────────────────────────

  const handlePreviewEdgeVoice = useCallback(async (edgeVoice: string, trackingKey: string) => {
    if (previewingId === trackingKey) {
      previewAudioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    previewAudioRef.current?.pause();
    setPreviewingId(trackingKey);
    try {
      const path = await voiceService.previewVoice(edgeVoice);
      const audio = new Audio(`file://${path}`);
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewingId(null);
      audio.play();
    } catch {
      setPreviewingId(null);
    }
  }, [previewingId]);

  // ── Select featured profile ─────────────────────────────────────────────────

  const handleSelectProfile = useCallback((profile: VoiceProfile) => {
    setSelectedVoiceId(profile.id);
    setActiveEdgeVoice(profile.edgeVoice || null);
    setActiveVoiceLabel(profile.name);
    setActiveVoiceProfile(profile);
  }, []);

  // ── Select voice from browser ───────────────────────────────────────────────

  const handleSelectBrowserVoice = useCallback((voice: EdgeVoice) => {
    setSelectedVoiceId(null); // deselect featured
    setActiveEdgeVoice(voice.name);
    setActiveVoiceLabel(voice.name);
  }, []);

  // ── Browser filter ──────────────────────────────────────────────────────────

  const filteredBrowserVoices = useMemo(() => {
    if (allVoices.length === 0) return [];
    const search = browserSearch.toLowerCase();
    return allVoices.filter((v) => {
      if (browserGender !== 'All' && v.gender.toLowerCase() !== browserGender.toLowerCase()) return false;
      if (browserLang !== 'All') {
        const group = getLocaleGroup(v.locale);
        if (group !== browserLang) return false;
      }
      if (search && !v.name.toLowerCase().includes(search) && !v.locale.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [allVoices, browserSearch, browserLang, browserGender]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    const canGenerate = dialogue.trim() && (activeEdgeVoice || (activeVoiceProfile?.elevenLabsVoiceId || activeVoiceProfile?.cartesiaVoiceId));
    if (!canGenerate || isVoiceGenerating) return; // app-level lock prevents remount bypass
    setGenState('generating');
    setGenProgress(0);
    setGenError(null);
    onVoiceGenerationStart?.(panel.id);

    const profile = activeVoiceProfile ?? {
      id: 'dynamic', name: activeVoiceLabel, description: '', gender: 'male' as const,
      language: '', edgeVoice: activeEdgeVoice ?? '',
    };
    const safeId = (activeEdgeVoice ?? activeVoiceProfile?.id ?? 'voice').replace(/[^a-z0-9_-]/gi, '-');
    try {
      const wavPath = await voiceService.generateVoice(
        dialogue.trim(),
        safeId,
        profile,
        (pct) => setGenProgress(pct),
      );
      setGeneratedWavPath(wavPath);
      setGenState('done');
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed');
      setGenState('error');
    } finally {
      onVoiceGenerationEnd?.(panel.id);
    }
  }, [activeEdgeVoice, activeVoiceProfile, activeVoiceLabel, dialogue, isVoiceGenerating, panel.id, onVoiceGenerationStart, onVoiceGenerationEnd]);

  // ── Playback ────────────────────────────────────────────────────────────────

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
    a.download = `voice_${activeEdgeVoice ?? 'output'}.wav`;
    a.click();
  }, [generatedWavPath, activeEdgeVoice]);

  const handleConfirm = useCallback(() => {
    if (!generatedWavPath) return;
    onComplete(generatedWavPath, selectedCharacterId);
  }, [generatedWavPath, selectedCharacterId, onComplete]);

  // ── Lip sync ────────────────────────────────────────────────────────────────

  async function handleGenerateLipSync() {
    if (!panel.voicePath || !panel.generatedImageData) return;
    setLipSyncError(null);
    setIsGeneratingLipSync(true);
    const imageBase64 = panel.generatedImageData.replace(/^data:image\/[^;]+;base64,/, '');
    const result = await lipSyncService.generateLipSync(
      imageBase64,
      panel.voicePath,
      (pct, message) => setLipSyncProgress({ pct, message })
    );
    setIsGeneratingLipSync(false);
    if (result?.error === 'insufficient_credits') {
      setLipSyncError("Not enough credits for lip sync (16 credits needed). Top up or wait for next month's allocation.");
      return;
    }
    if (result?.videoUrl) onLipSyncComplete(result.videoUrl);
  }

  // ── Voice clone ─────────────────────────────────────────────────────────────

  const handleClone = useCallback(async () => {
    if (!cloneFile || !cloneName.trim()) return;

    // Validate file
    const maxSize = 10 * 1024 * 1024;
    if (cloneFile.size > maxSize) {
      setCloneError('File too large — maximum 10MB per file');
      return;
    }
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/x-m4a'];
    if (!allowedTypes.includes(cloneFile.type) && !/\.(mp3|wav|m4a|ogg)$/i.test(cloneFile.name)) {
      setCloneError('Unsupported format — use MP3, WAV, M4A, or OGG');
      return;
    }

    setIsCloning(true);
    setCloneError(null);
    try {
      const result = await voiceService.cloneVoice((cloneFile as any).path ?? cloneFile.name, cloneName.trim());
      const profile: VoiceProfile = {
        id: `${result.provider}-${result.voiceId}`,
        name: result.name,
        description: '',
        gender: 'male',
        language: 'en-US',
        edgeVoice: '',
        isCustom: true,
        tier: 'studio',
        provider: result.provider,
        elevenLabsVoiceId: result.provider === 'elevenlabs' ? result.voiceId : undefined,
        cartesiaVoiceId:   result.provider === 'cartesia'   ? result.voiceId : undefined,
      };
      await (window as any).electronAPI?.saveCustomVoice?.({ voice: profile });
      setVoices((prev) => [...prev, profile]);
      handleSelectProfile(profile);
      setCloneFile(null);
      setCloneName('');
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : 'Cloning failed');
    } finally {
      setIsCloning(false);
    }
  }, [cloneFile, cloneName, handleSelectProfile]);

  const handleDeleteCustomVoice = useCallback(async (voiceId: string) => {
    await (window as any).electronAPI?.deleteCustomVoice?.({ voiceId });
    setVoices((prev) => prev.filter(v => v.id !== voiceId));
    if (activeVoiceProfile?.id === voiceId) {
      setActiveVoiceProfile(null);
      setActiveEdgeVoice(null);
      setSelectedVoiceId(null);
    }
  }, [activeVoiceProfile]);

  // ── Community gate ───────────────────────────────────────────────────────────

  if (!isPro) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        tabIndex={-1}
      >
        <div
          className="relative bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-sm w-full mx-4 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <Lock className="w-10 h-10 text-imagginary-500/60 mx-auto mb-4" />
          <p className="text-base font-semibold text-gray-100 mb-2">Voice Studio — Pro Feature</p>
          <p className="text-sm text-gray-500 mb-6">
            Generate character dialogue with 300+ multilingual voices.
            Custom voice cloning available on Studio.
          </p>
          <button className="px-5 py-2.5 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors">
            Upgrade to Pro — $19/month
          </button>
        </div>
      </div>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-imagginary-400" />
            <span className="text-sm font-semibold text-gray-100">Voice Studio</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-imagginary-900/40 text-imagginary-400 border border-imagginary-800/40 font-medium uppercase tracking-wide">Pro</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── Checking ───────────────────────────────────────────────────── */}
          {installState === 'checking' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
              <p className="text-sm text-gray-500">Checking edge-tts…</p>
            </div>
          )}

          {/* ── Not installed ───────────────────────────────────────────────── */}
          {installState === 'not-installed' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
              <MicOff className="w-10 h-10 text-gray-600" />
              <p className="text-sm font-semibold text-gray-200">edge-tts not installed</p>
              <p className="text-xs text-gray-500 text-center max-w-sm">
                Voice generation uses Microsoft Edge TTS (~5 MB). Works on any Python version — no GPU required.
              </p>
              <button
                onClick={handleInstall}
                className="px-5 py-2.5 bg-imagginary-600 hover:bg-imagginary-500 text-black text-sm font-semibold rounded-lg transition-colors"
              >
                Install edge-tts
              </button>
            </div>
          )}

          {/* ── Installing ─────────────────────────────────────────────────── */}
          {installState === 'installing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-8">
              <Loader2 className="w-6 h-6 text-imagginary-400 animate-spin" />
              <p className="text-sm font-medium text-gray-200">Installing edge-tts…</p>
              <p className="text-xs text-gray-500 font-mono text-center max-w-md">{installProgress}</p>
            </div>
          )}

          {/* ── Install failed ─────────────────────────────────────────────── */}
          {installState === 'failed' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <p className="text-sm font-semibold text-gray-200">Install failed</p>
              <p className="text-xs text-gray-500 text-center max-w-sm">
                Run{' '}
                <code className="font-mono bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">pip install edge-tts</code>
                {' '}then reopen Voice Studio.
              </p>
              <button onClick={handleInstall} className="flex items-center gap-1.5 text-xs text-imagginary-400 hover:text-imagginary-300">
                <RefreshCw className="w-3 h-3" /> Try again
              </button>
            </div>
          )}

          {/* ── Main UI ────────────────────────────────────────────────────── */}
          {installState === 'available' && (
            <div className="p-5 space-y-5">

              {/* ── Featured Voices ─────────────────────────────────────────── */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Featured Voices</p>
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
                        onSelect={() => handleSelectProfile(v)}
                        onPreview={() => handlePreviewEdgeVoice(v.edgeVoice, v.id)}
                        isPreviewing={previewingId === v.id}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* ── Browse All Voices ───────────────────────────────────────── */}
              <div className="rounded-lg border border-gray-800 bg-gray-900/30 overflow-hidden">
                <button
                  onClick={() => setShowBrowser((b) => !b)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5" />
                    Browse all 300+ voices
                    {activeEdgeVoice && !selectedVoiceId && (
                      <span className="ml-2 text-[10px] text-imagginary-400 font-normal">
                        Selected: {activeVoiceLabel}
                      </span>
                    )}
                  </div>
                  {showBrowser ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showBrowser && (
                  <div className="border-t border-gray-800 p-4 space-y-3">
                    {/* Filters */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative flex-1 min-w-36">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600" />
                        <input
                          value={browserSearch}
                          onChange={(e) => setBrowserSearch(e.target.value)}
                          placeholder="Search by name or locale…"
                          className="w-full pl-7 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-imagginary-500"
                        />
                      </div>
                      <select
                        value={browserLang}
                        onChange={(e) => setBrowserLang(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-imagginary-500"
                      >
                        <option value="All">All languages</option>
                        {Object.keys(LANG_GROUPS).map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <select
                        value={browserGender}
                        onChange={(e) => setBrowserGender(e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-imagginary-500"
                      >
                        <option value="All">All genders</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                    </div>

                    {/* Voice list */}
                    {allVoices.length === 0 ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                      </div>
                    ) : filteredBrowserVoices.length === 0 ? (
                      <p className="text-xs text-gray-600 text-center py-4">No voices match your filters.</p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
                        {filteredBrowserVoices.map((v) => (
                          <BrowserRow
                            key={v.name}
                            voice={v}
                            isSelected={activeEdgeVoice === v.name}
                            isPreviewing={previewingId === v.name}
                            onSelect={() => handleSelectBrowserVoice(v)}
                            onPreview={() => handlePreviewEdgeVoice(v.name, v.name)}
                          />
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-700 text-right">
                      {filteredBrowserVoices.length} of {allVoices.length} voices
                    </p>
                  </div>
                )}
              </div>

              {/* ── Dialogue ────────────────────────────────────────────────── */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Dialogue</p>

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

                <textarea
                  value={dialogue}
                  onChange={(e) => setDialogue(e.target.value)}
                  placeholder="Write dialogue for this character…"
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-imagginary-500 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none resize-none transition-colors"
                />

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleGenerate}
                    disabled={!(dialogue.trim() && (activeEdgeVoice || (activeVoiceProfile?.elevenLabsVoiceId || activeVoiceProfile?.cartesiaVoiceId))) || isVoiceGenerating || genState === 'generating'}
                    className="flex items-center gap-2 px-4 py-2 bg-imagginary-600 hover:bg-imagginary-500 text-black text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {genState === 'generating'
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                      : <><Volume2 className="w-3 h-3" /> Generate Voice</>}
                  </button>
                  {activeEdgeVoice && (
                    <p className="text-[10px] text-gray-600">
                      Using: <span className="text-gray-400">{activeVoiceLabel}</span>
                    </p>
                  )}
                </div>

                {genState === 'generating' && <ProgressBar pct={genProgress} label="Synthesising speech…" />}

                {genState === 'error' && genError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-950/30 border border-red-800/40">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{genError}</p>
                  </div>
                )}
              </div>

              {/* ── Result ──────────────────────────────────────────────────── */}
              {generatedWavPath && genState === 'done' && (
                <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <p className="text-xs font-semibold text-gray-200">Voice generated</p>
                  </div>
                  <p className="text-[10px] text-gray-600 font-mono truncate">{generatedWavPath}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={handlePlayResult} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors">
                      {isPlayingResult ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Play</>}
                    </button>
                    <button onClick={handleDownload} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors">
                      <Download className="w-3 h-3" /> Download WAV
                    </button>
                    <button onClick={handleConfirm} className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors">
                      <CheckCircle className="w-3 h-3" /> Save to Panel
                    </button>
                  </div>
                </div>
              )}

              {/* ── Studio: Cloned Voices list ───────────────────────────────── */}
              {isStudio && voices.filter(v => v.isCustom).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Your Cloned Voices</p>
                  {voices.filter(v => v.isCustom).map(voice => (
                    <div
                      key={voice.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        activeVoiceProfile?.id === voice.id
                          ? 'bg-violet-500/20 border border-violet-500/40'
                          : 'hover:bg-gray-800 border border-transparent'
                      }`}
                      onClick={() => handleSelectProfile(voice)}
                    >
                      <div className="flex items-center gap-2">
                        <Mic className="w-3 h-3 text-violet-400" />
                        <span className="text-sm text-white">{voice.name}</span>
                        <span className="text-[9px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-full">Cloned</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCustomVoice(voice.id); }}
                        className="text-gray-600 hover:text-red-400 transition-colors p-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Studio: Voice cloning ────────────────────────────────────── */}
              {isStudio && (
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Clone a New Voice</p>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-violet-900/30 text-violet-400 border border-violet-800/30 font-medium uppercase">Studio</span>
                  </div>
                  {cloneProvider ? (
                    <p className="text-[10px] text-gray-500">
                      Voice cloning via {cloneProvider === 'cartesia' ? 'Cartesia Sonic' : 'ElevenLabs'}
                      {cloneProvider === 'elevenlabs' ? ' (your API key)' : ''}
                    </p>
                  ) : (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                      <p className="text-amber-400 text-[10px]">
                        Voice cloning is not yet configured for this build. Contact support.
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600">Upload a clear audio sample — 1 minute minimum, 5+ minutes for best quality.</p>
                  <input ref={cloneInputRef} type="file" accept=".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/x-m4a" className="hidden" onChange={(e) => setCloneFile(e.target.files?.[0] ?? null)} />
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
                          disabled={!cloneName.trim() || isCloning || !cloneAvailable}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {isCloning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                          {isCloning ? 'Cloning…' : 'Clone Voice'}
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600">MP3, WAV, M4A or OGG · Max 10MB · 1+ minute recommended for best quality</p>
                  <p className="text-[10px] text-gray-600">
                    Voice is processed and stored securely via ElevenLabs. Only you can access your cloned voice.
                  </p>
                  {cloneError && <p className="text-[10px] text-red-400">{cloneError}</p>}
                </div>
              )}

              {/* ── Lip Sync ─────────────────────────────────────────────────── */}
              {panel.voicePath ? (
                lipSyncAvailable ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400">Lip Sync</p>
                    {isGeneratingLipSync ? (
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {lipSyncProgress.message}
                      </div>
                    ) : panel.lipSyncPath ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-green-500">Lip sync ready</p>
                        <button onClick={handleGenerateLipSync} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Regenerate</button>
                      </div>
                    ) : (
                      <>
                        <button onClick={handleGenerateLipSync} className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-colors">
                          Generate Lip Sync
                        </button>
                        {lipSyncError && <p className="text-[10px] text-red-400 mt-1">{lipSyncError}</p>}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/30 p-4 text-center space-y-2">
                    <p className="text-xs font-semibold text-gray-500">Lip Sync</p>
                    <p className="text-[10px] text-gray-600">Add your Sync.so API key in Settings to enable lip sync.</p>
                    <button onClick={onOpenSettings} className="text-[10px] text-imagginary-500 hover:text-imagginary-400 transition-colors">Open Settings →</button>
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/30 p-4 text-center">
                  <p className="text-[10px] text-gray-700">Generate voice first to enable lip sync.</p>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
