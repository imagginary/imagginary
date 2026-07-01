/**
 * Phase 6E — VideoTransfer
 *
 * Modal for uploading a reference video and transferring its pose sequence
 * onto a character via ControlNet + Wan 2.2.
 *
 * Flow:
 *   1. Drop zone → file selected
 *   2. Validation panel (duration, quality, warnings)
 *   3. "Extract Poses" → animated stick-figure preview of extracted sequence
 *   4. Character selector + motion prompt
 *   5. "Apply to Character" → generates output clip
 *
 * Pro+ only — Community users see an upgrade prompt.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Upload, Film, Loader2, CheckCircle, AlertCircle, ChevronRight,
  Lock, Sparkles, RefreshCw, Check,
} from 'lucide-react';
import { Character, VideoValidationResult, Panel } from '../types';
import { PoseKeyframe, SKELETON_CONNECTIONS } from '../data/PoseVocabulary';
import { videoTransferService } from '../services/VideoTransferService';
import { ProFeatureGate } from './ProFeatureGate';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoTransferProps {
  panel: Panel;
  characters: Character[];
  isPro: boolean;
  onComplete: (videoData: string, clipPath: string | null) => void;
  onClose: () => void;
  onUpgrade?: () => void;
}

type Step = 'upload' | 'validating' | 'validated' | 'extracting' | 'extracted' | 'applying' | 'done';

// ── Stick figure (reuses PoseEngineService renderer logic inline) ──────────────

function StickFigure({
  keyframe,
  width = 80,
  height = 110,
}: {
  keyframe: PoseKeyframe;
  width?: number;
  height?: number;
}) {
  const joints = keyframe.joints;

  const circles = joints.map((j, i) => {
    if (!j) return null;
    const cx = j.x * width;
    const cy = j.y * height;
    const r = i < 5 ? 3.5 : 2.5;
    return <circle key={i} cx={cx} cy={cy} r={r} fill="#a78bfa" />;
  });

  const lines = SKELETON_CONNECTIONS.map(([a, b], i) => {
    const ja = joints[a];
    const jb = joints[b];
    if (!ja || !jb) return null;
    return (
      <line
        key={i}
        x1={ja.x * width}
        y1={ja.y * height}
        x2={jb.x * width}
        y2={jb.y * height}
        stroke="#7c3aed"
        strokeWidth={2}
        strokeLinecap="round"
      />
    );
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="overflow-visible"
    >
      {lines}
      {circles}
    </svg>
  );
}

// ── Animated pose preview ─────────────────────────────────────────────────────

function AnimatedPosePreview({ sequence }: { sequence: PoseKeyframe[] }) {
  const [frame, setFrame] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const FPS = 12;

  useEffect(() => {
    if (sequence.length === 0) return;
    function tick(time: number) {
      if (time - lastTimeRef.current >= 1000 / FPS) {
        setFrame((f) => (f + 1) % sequence.length);
        lastTimeRef.current = time;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [sequence.length]);

  if (sequence.length === 0) return null;
  const kf = sequence[frame] ?? sequence[0];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-3 flex items-center justify-center" style={{ minWidth: 100, minHeight: 130 }}>
        <StickFigure keyframe={kf} width={80} height={110} />
      </div>
      <p className="text-[10px] text-gray-600 font-mono">
        {frame + 1}/{sequence.length}
      </p>
    </div>
  );
}

// ── Quality badge ─────────────────────────────────────────────────────────────

function QualityBadge({ score }: { score: number }) {
  const { label, cls } = score >= 75
    ? { label: 'Good', cls: 'text-green-400 bg-green-900/30 border-green-700/50' }
    : score >= 50
      ? { label: 'Fair', cls: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50' }
      : { label: 'Poor', cls: 'text-red-400 bg-red-900/30 border-red-700/50' };

  return (
    <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${cls}`}>
      {label} · {score}
    </span>
  );
}

// ── Best-results checklist ────────────────────────────────────────────────────

const BEST_RESULTS = [
  'Single person clearly visible',
  'Moderate motion speed',
  'Stable camera',
  'Good lighting',
  'Under 30 seconds',
];

// ── Main component ────────────────────────────────────────────────────────────

export default function VideoTransfer({
  panel,
  characters,
  isPro,
  onComplete,
  onClose,
  onUpgrade,
}: VideoTransferProps) {
  const [step, setStep] = useState<Step>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [validation, setValidation] = useState<VideoValidationResult | null>(null);
  const [poseSequence, setPoseSequence] = useState<PoseKeyframe[]>([]);
  const [tempDir, setTempDir] = useState('');
  const [extractProgress, setExtractProgress] = useState(0);
  const [applyProgress, setApplyProgress] = useState(0);
  const [selectedCharId, setSelectedCharId] = useState<string>(
    panel.characters[0] ?? characters[0]?.id ?? ''
  );
  const [motionPrompt, setMotionPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedChar = characters.find((c) => c.id === selectedCharId) ?? null;

  // ── Pro gate (defense-in-depth — toolbar button already blocks Community users) ──
  if (!isPro) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-gray-950 border border-gray-800 rounded-xl max-w-sm w-full mx-4">
          <ProFeatureGate
            feature="Video Transfer"
            description="Record yourself doing an action and transfer the exact motion to your character. Pose retargeting via Wan Motion cloud."
            highlight="Upload any MP4 · motion transfers in ~2 min · no GPU needed"
            onUpgrade={() => { onUpgrade?.(); onClose(); }}
            tierRequired="pro"
          />
          <button
            onClick={onClose}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors w-full text-center pb-5"
          >
            Maybe later
          </button>
        </div>
      </div>
    );
  }

  // ── File handling ─────────────────────────────────────────────────────────────

  async function handleFileSelect(filePath: string) {
    if (!filePath) return;
    setSelectedFilePath(filePath);
    setFileName(filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath);
    setValidation(null);
    setPoseSequence([]);
    setError(null);
    setStep('validating');
    await runValidation(filePath);
  }

  async function handleBrowseFile() {
    const result = await window.electronAPI!.showOpenDialog({
      title: 'Select Reference Video',
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'webm', 'gif'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths?.length > 0) {
      await handleFileSelect(result.filePaths[0]);
    }
  }

  async function runValidation(filePath: string) {
    try {
      const result = await videoTransferService.validateVideo(filePath);
      setValidation(result);
      setStep('validated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
      setStep('upload');
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = (file as any).path;
    if (filePath) {
      await handleFileSelect(filePath);
    } else {
      await handleBrowseFile();
    }
  }

  // ── Step 1: Extract poses ─────────────────────────────────────────────────────

  async function handleExtract() {
    if (!selectedFilePath) return;
    setStep('extracting');
    setExtractProgress(0);
    setError(null);
    try {
      const { sequence, tempDir: td } = await videoTransferService.extractPoseSequence(
        selectedFilePath,
        setExtractProgress
      );
      setPoseSequence(sequence);
      setTempDir(td);
      setExtractProgress(100);
      setStep('extracted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
      setStep('validated');
    }
  }

  // ── Step 2: Apply to character ────────────────────────────────────────────────

  async function handleApply() {
    if (!selectedChar?.referenceImagePath) {
      setError('Selected character has no reference image. Generate one first.');
      return;
    }
    if (poseSequence.length === 0) return;
    setStep('applying');
    setApplyProgress(0);
    setError(null);
    try {
      const videoData = await videoTransferService.applyToCharacter(
        poseSequence,
        selectedChar.referenceImagePath,
        motionPrompt,
        setApplyProgress,
        selectedFilePath || undefined  // cloud path: pass source video for wan-motion upload
      );
      setApplyProgress(100);
      setStep('done');
      // Cleanup temp frames in the background
      if (tempDir) videoTransferService.cleanupTempFrames(tempDir).catch(() => {});
      onComplete(videoData, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
      setStep('extracted');
    }
  }

  function handleReset() {
    setStep('upload');
    setSelectedFilePath('');
    setFileName('');
    setValidation(null);
    setPoseSequence([]);
    setExtractProgress(0);
    setApplyProgress(0);
    setError(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const isWorking = step === 'validating' || step === 'extracting' || step === 'applying';
  const canExtract = step === 'validated' && (validation?.valid ?? false);
  const canApply = step === 'extracted' && poseSequence.length > 0 && !!selectedChar;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl flex flex-col w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Film className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-gray-100">Video Transfer</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-imagginary-900/60 text-imagginary-400 border border-imagginary-700/40 uppercase tracking-wide">Pro+</span>
          </div>
          <button
            onClick={onClose}
            disabled={isWorking}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 min-h-0">

          {/* ── Error banner ─────────────────────────────────────────── */}
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-red-950/50 border border-red-700/50 rounded-lg text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Upload zone ──────────────────────────────────────────── */}
          {(step === 'upload' || step === 'validating') && (
            <div className="flex flex-col gap-4">
              {/* Best-results checklist */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-300 mb-3">Best results when:</p>
                <ul className="space-y-1.5">
                  {BEST_RESULTS.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-xs text-gray-400">
                      <Check className="w-3 h-3 text-green-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={handleBrowseFile}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-violet-500 bg-violet-950/20'
                    : 'border-gray-700 hover:border-gray-600 bg-gray-900/50 hover:bg-gray-900'
                }`}
              >
                {step === 'validating' ? (
                  <>
                    <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                    <p className="text-sm text-gray-400">Validating video…</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-500" />
                    <div className="text-center">
                      <p className="text-sm text-gray-300 font-medium">Drop video here or click to browse</p>
                      <p className="text-xs text-gray-600 mt-1">MP4, MOV, AVI, WebM · max 30 seconds</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Validation panel ─────────────────────────────────────── */}
          {(step === 'validated' || step === 'extracting' || step === 'extracted' || step === 'applying' || step === 'done') && validation && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              {/* File info row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Film className="w-4 h-4 text-gray-500 shrink-0" />
                  <span className="text-xs text-gray-300 truncate font-medium">
                    {fileName || 'Video file'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <QualityBadge score={validation.estimatedQuality} />
                  <button
                    onClick={handleReset}
                    disabled={isWorking}
                    className="p-1 rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors disabled:opacity-30"
                    title="Choose different file"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Metadata tags */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px] font-mono">
                  {validation.duration.toFixed(1)}s
                </span>
                <span className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px] font-mono">
                  ~{validation.frameCount} frames
                </span>
              </div>

              {/* Rejection reason */}
              {!validation.valid && validation.rejectionReason && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-950/40 border border-red-700/40 rounded-lg mb-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{validation.rejectionReason}</p>
                </div>
              )}

              {/* Warnings */}
              {validation.warnings.length > 0 && (
                <ul className="space-y-1.5">
                  {validation.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-1.5 text-[11px] text-yellow-400">
                      <span className="mt-px shrink-0">⚠</span>
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── Pose preview ─────────────────────────────────────────── */}
          {(step === 'extracted' || step === 'applying' || step === 'done') && poseSequence.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                <p className="text-xs font-semibold text-gray-300">Extracted Pose Sequence</p>
                <span className="text-[10px] text-gray-600 font-mono ml-auto">
                  {poseSequence.length} keyframes
                </span>
              </div>

              <div className="flex gap-3 overflow-x-auto pb-1">
                {/* Animated preview */}
                <div className="shrink-0">
                  <AnimatedPosePreview sequence={poseSequence} />
                </div>
                {/* Static thumbnails — every Nth frame */}
                <div className="flex items-center gap-2 overflow-x-auto">
                  {poseSequence
                    .filter((_, i) => i % Math.max(1, Math.floor(poseSequence.length / 6)) === 0)
                    .slice(0, 6)
                    .map((kf, i) => (
                      <div
                        key={i}
                        className="bg-gray-800 rounded border border-gray-700 p-1.5 shrink-0 flex items-center justify-center"
                        style={{ width: 52, height: 72 }}
                      >
                        <StickFigure keyframe={kf} width={40} height={56} />
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Character + prompt ───────────────────────────────────── */}
          {(step === 'extracted' || step === 'applying') && (
            <div className="flex flex-col gap-3">
              {/* Character selector */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Apply to character</label>
                {characters.length === 0 ? (
                  <p className="text-xs text-gray-600">No characters in this project — create one first.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {characters.map((char) => (
                      <button
                        key={char.id}
                        onClick={() => setSelectedCharId(char.id)}
                        disabled={step === 'applying'}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-60 ${
                          selectedCharId === char.id
                            ? 'border-violet-500 bg-violet-900/30 text-violet-300'
                            : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {char.referenceImageData && (
                          <img
                            src={char.referenceImageData}
                            alt={char.name}
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        {char.name}
                        {!char.referenceImagePath && (
                          <span className="text-[9px] text-yellow-600 ml-0.5">(no image)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Motion prompt */}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Motion prompt <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={motionPrompt}
                  onChange={(e) => setMotionPrompt(e.target.value)}
                  disabled={step === 'applying'}
                  placeholder="cinematic animation, smooth motion, character walks forward…"
                  className="w-full bg-gray-800 border border-gray-700 focus:border-violet-500 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {/* ── Extraction progress ───────────────────────────────────── */}
          {step === 'extracting' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                <p className="text-sm text-gray-300">Extracting pose sequence…</p>
                <span className="text-xs text-gray-500 font-mono ml-auto">{Number(extractProgress).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${extractProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-600">
                Running ffmpeg frame extraction at 24fps · GPU OpenPose if available, synthetic fallback on CPU
              </p>
            </div>
          )}

          {/* ── Apply progress ───────────────────────────────────────── */}
          {step === 'applying' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                <p className="text-sm text-gray-300">Applying to character via ComfyUI…</p>
                <span className="text-xs text-gray-500 font-mono ml-auto">{Number(applyProgress).toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${applyProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-600">
                ControlNet + Wan 2.2 · ~3–8 min on Apple Silicon
              </p>
            </div>
          )}

          {/* ── Done state ───────────────────────────────────────────── */}
          {step === 'done' && (
            <div className="flex items-center gap-3 px-4 py-3 bg-green-950/40 border border-green-700/40 rounded-xl">
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-300">Transfer complete</p>
                <p className="text-xs text-gray-500 mt-0.5">Motion clip saved to panel</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 border-t border-gray-800 flex items-center gap-2 shrink-0">
          {/* Extract button */}
          {canExtract && (
            <button
              onClick={handleExtract}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Extract Poses
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Apply button */}
          {canApply && (
            <button
              onClick={handleApply}
              disabled={!selectedChar?.referenceImagePath}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={!selectedChar?.referenceImagePath ? 'Character needs a reference image' : ''}
            >
              <Film className="w-3.5 h-3.5" />
              Apply to Character
            </button>
          )}

          {/* Cancel / close */}
          {step === 'done' ? (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors ml-auto"
            >
              <Check className="w-3.5 h-3.5" />
              Done
            </button>
          ) : (
            <button
              onClick={onClose}
              disabled={isWorking}
              className="ml-auto flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-30"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
