/**
 * Phase 6B — PoseEditor
 *
 * Full-screen modal for composing a pose sequence and generating a
 * skeleton-guided animation clip for a storyboard panel.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │  Header (title + close)                     │
 *   ├──────────────────┬─────────────────────────┤
 *   │  Left column     │  Right column            │
 *   │  ─────────       │  ──────────              │
 *   │  Pose Library    │  Selected sequence        │
 *   │  (browse grid +  │  timeline +              │
 *   │   text search)   │  animated preview         │
 *   │                  │  + generate button        │
 *   └──────────────────┴─────────────────────────┘
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Search,
  Play,
  Pause,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  Film,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

import { Panel } from '../types';
import {
  POSE_VOCABULARY,
  PoseTemplate,
  PoseKeyframe,
  PoseCategory,
  searchPoses,
  renderPoseToDataURL,
  SKELETON_CONNECTIONS,
} from '../data/PoseVocabulary';
import {
  buildKeyframeSequence,
  expandSequence,
  matchPoseTemplates,
} from '../services/PoseEngineService';

// ── Props ────────────────────────────────────────────────────────────────────

interface PoseEditorProps {
  panel: Panel;
  isPro: boolean;
  isGenerating: boolean;
  onGenerate: (params: {
    poseTemplateIds: string[];
    description: string;
    framesPerSegment: number;
  }) => Promise<void>;
  onClose: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { id: PoseCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'standing', label: 'Standing' },
  { id: 'sitting', label: 'Sitting' },
  { id: 'action', label: 'Action' },
  { id: 'combat', label: 'Combat' },
  { id: 'expressive', label: 'Expressive' },
  { id: 'ground', label: 'Ground' },
  { id: 'cinematic', label: 'Cinematic' },
];

const FRAMES_OPTIONS = [8, 12, 16, 24];

// ── Stick Figure SVG Renderer ─────────────────────────────────────────────────

interface StickFigureProps {
  keyframe: PoseKeyframe;
  width?: number;
  height?: number;
  dim?: boolean;
  highlight?: boolean;
}

function StickFigure({ keyframe, width = 80, height = 108, dim = false, highlight = false }: StickFigureProps) {
  const joints = keyframe.joints;
  const opacity = dim ? 0.35 : 1;
  const lineColor = highlight ? '#c4b5fd' : '#7c3aed';
  const dotColor = highlight ? '#ddd6fe' : '#a78bfa';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ opacity }}
      aria-hidden
    >
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const ja = joints[a];
        const jb = joints[b];
        if (!ja || !jb) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={(ja.x * width).toFixed(1)}
            y1={(ja.y * height).toFixed(1)}
            x2={(jb.x * width).toFixed(1)}
            y2={(jb.y * height).toFixed(1)}
            stroke={lineColor}
            strokeWidth={highlight ? 2.5 : 2}
            strokeLinecap="round"
          />
        );
      })}
      {joints.map((j, i) => {
        if (!j) return null;
        return (
          <circle
            key={i}
            cx={(j.x * width).toFixed(1)}
            cy={(j.y * height).toFixed(1)}
            r={i < 5 ? 3.5 : 2.5}
            fill={dotColor}
          />
        );
      })}
    </svg>
  );
}

// ── Pose Card ────────────────────────────────────────────────────────────────

interface PoseCardProps {
  template: PoseTemplate;
  selected: boolean;
  onClick: () => void;
}

function PoseCard({ template, selected, onClick }: PoseCardProps) {
  return (
    <button
      onClick={onClick}
      title={template.description}
      className={`relative flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-left ${
        selected
          ? 'border-violet-500 bg-violet-900/30 shadow-md shadow-violet-900/40'
          : 'border-gray-700 bg-gray-900 hover:border-gray-500 hover:bg-gray-800'
      }`}
    >
      <div className="w-[80px] h-[108px] flex items-center justify-center">
        <StickFigure keyframe={template.keyframe} highlight={selected} />
      </div>
      <span className="text-[10px] text-center text-gray-300 leading-tight line-clamp-2 w-full">
        {template.name}
      </span>
      {selected && (
        <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-violet-500 flex items-center justify-center">
          <span className="text-[7px] font-bold text-white">✓</span>
        </div>
      )}
    </button>
  );
}

// ── Animated Sequence Preview ─────────────────────────────────────────────────

interface SequencePreviewProps {
  frames: PoseKeyframe[];
  fps?: number;
}

function SequencePreview({ frames, fps = 8 }: SequencePreviewProps) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setFrameIdx(0);
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (playing && frames.length > 1) {
      timerRef.current = setInterval(() => {
        setFrameIdx((idx) => (idx + 1) % frames.length);
      }, 1000 / fps);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, frames, fps]);

  if (frames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-600 gap-2">
        <Film className="w-8 h-8" />
        <span className="text-xs">Add poses to preview</span>
      </div>
    );
  }

  const current = frames[frameIdx];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-3">
        <StickFigure keyframe={current} width={100} height={135} highlight />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPlaying((v) => !v)}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white text-xs font-medium transition-colors"
        >
          {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="text-[10px] text-gray-500">
          {frameIdx + 1}/{frames.length}
        </span>
      </div>
      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={frameIdx}
        onChange={(e) => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
        className="w-full h-1 accent-violet-500"
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PoseEditor({
  panel,
  isPro,
  isGenerating,
  onGenerate,
  onClose,
}: PoseEditorProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<PoseCategory | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [framesPerSegment, setFramesPerSegment] = useState(12);
  const [autoMatchDone, setAutoMatchDone] = useState(false);
  const [showControlnetDownload, setShowControlnetDownload] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadMb, setDownloadMb] = useState('0');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Derive filtered library
  const filteredPoses = React.useMemo(() => {
    let list = search.trim()
      ? searchPoses(search, 50)
      : POSE_VOCABULARY;
    if (categoryFilter !== 'all') {
      list = list.filter((p) => p.category === categoryFilter);
    }
    return list;
  }, [search, categoryFilter]);

  // Auto-match on mount if panel has a motion description
  useEffect(() => {
    if (autoMatchDone) return;
    setAutoMatchDone(true);
    const seed = panel.motionDescription || panel.shotDescription;
    if (seed) {
      const matches = matchPoseTemplates(seed, 2);
      if (matches.length > 0) {
        setSelectedIds(matches.map((m) => m.id));
        setDescription(seed);
      }
    }
  }, []);

  // Dense frames for preview
  const previewFrames = React.useMemo(() => {
    if (selectedIds.length === 0) return [];
    const kfs = buildKeyframeSequence(selectedIds);
    return expandSequence(kfs, Math.min(framesPerSegment, 8)); // keep preview fast
  }, [selectedIds, framesPerSegment]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const togglePose = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const removePose = useCallback((id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const movePose = useCallback((id: string, dir: -1 | 1) => {
    setSelectedIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }, []);

  const handleAutoMatch = () => {
    if (!description.trim()) return;
    const matches = matchPoseTemplates(description, 3);
    setSelectedIds(matches.map((m) => m.id));
  };

  const handleGenerate = async () => {
    if (selectedIds.length === 0) return;
    try {
      await onGenerate({ poseTemplateIds: selectedIds, description, framesPerSegment });
    } catch (err) {
      if (err instanceof Error && err.message === 'CONTROLNET_NOT_INSTALLED') {
        setShowControlnetDownload(true);
      }
    }
  };

  const handleDownloadControlnet = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadProgress(0);

    const cleanup = (window as any).electronAPI?.onControlnetDownloadProgress?.(
      (data: { pct: number; mb: string }) => {
        setDownloadProgress(data.pct);
        setDownloadMb(data.mb);
      }
    );

    try {
      const result = await (window as any).electronAPI?.downloadControlnetOpenpose?.();
      if (result?.success) {
        setShowControlnetDownload(false);
        // Retry generation automatically
        await onGenerate({ poseTemplateIds: selectedIds, description, framesPerSegment });
      } else {
        setDownloadError(result?.error ?? 'Download failed. Please try again.');
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      cleanup?.();
      setIsDownloading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const selectedTemplates = selectedIds
    .map((id) => POSE_VOCABULARY.find((p) => p.id === id))
    .filter((t): t is PoseTemplate => !!t);

  const canGenerate = selectedIds.length > 0 && !isGenerating;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[90vh] bg-gray-950 border border-gray-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-violet-900/60 border border-violet-700/50 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Pose Engine</h2>
              <p className="text-[10px] text-gray-500">
                Compose a skeleton sequence to animate this panel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* ── Left: Pose Library ──────────────────────────────────────────── */}
          <div className="w-[55%] flex flex-col border-r border-gray-800 min-h-0">

            {/* Search + category */}
            <div className="px-4 pt-4 pb-2 space-y-2 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search poses…"
                  className="w-full bg-gray-900 border border-gray-700 focus:border-violet-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none transition-colors"
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryFilter(cat.id as PoseCategory | 'all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      categoryFilter === cat.id
                        ? 'bg-violet-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-4 gap-2">
                {filteredPoses.map((template) => (
                  <PoseCard
                    key={template.id}
                    template={template}
                    selected={selectedIds.includes(template.id)}
                    onClick={() => togglePose(template.id)}
                  />
                ))}
                {filteredPoses.length === 0 && (
                  <div className="col-span-4 py-12 text-center text-gray-600 text-xs">
                    No poses match "{search}"
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: Sequence + Controls ──────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">

            {/* Description + auto-match */}
            <div className="shrink-0 space-y-2">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                Describe the action
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAutoMatch()}
                  placeholder="e.g. hero punches then falls to knees"
                  className="flex-1 bg-gray-900 border border-gray-700 focus:border-violet-500 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none transition-colors"
                />
                <button
                  onClick={handleAutoMatch}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition-colors whitespace-nowrap"
                  title="Auto-match poses from description"
                >
                  Auto-match
                </button>
              </div>
            </div>

            {/* Selected sequence timeline */}
            <div className="shrink-0 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Sequence ({selectedTemplates.length} pose{selectedTemplates.length !== 1 ? 's' : ''})
                </label>
                {selectedTemplates.length > 0 && (
                  <button
                    onClick={() => setSelectedIds([])}
                    className="text-[10px] text-gray-600 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap min-h-[52px] p-2 bg-gray-900 border border-gray-800 rounded-lg">
                {selectedTemplates.length === 0 ? (
                  <span className="text-xs text-gray-700 self-center px-1">
                    Click poses in the library to add them →
                  </span>
                ) : (
                  selectedTemplates.map((template, idx) => (
                    <div
                      key={`${template.id}-${idx}`}
                      className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1"
                    >
                      {/* Mini stick figure */}
                      <StickFigure keyframe={template.keyframe} width={28} height={38} />
                      <div className="flex flex-col">
                        <span className="text-[9px] text-gray-300 leading-tight max-w-[56px] truncate">
                          {template.name}
                        </span>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          <button
                            onClick={() => movePose(template.id, -1)}
                            disabled={idx === 0}
                            className="p-0.5 rounded text-gray-600 hover:text-gray-300 disabled:opacity-20"
                          >
                            <ChevronLeft className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() => movePose(template.id, 1)}
                            disabled={idx === selectedTemplates.length - 1}
                            className="p-0.5 rounded text-gray-600 hover:text-gray-300 disabled:opacity-20"
                          >
                            <ChevronRight className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() => removePose(template.id)}
                            className="p-0.5 rounded text-gray-600 hover:text-red-400"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Animated preview */}
            <div className="flex-1 flex flex-col items-center justify-center min-h-0">
              <SequencePreview frames={previewFrames} fps={8} />
            </div>

            {/* Frames-per-segment picker */}
            <div className="shrink-0 space-y-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                Smoothness (frames between poses)
              </label>
              <div className="flex gap-1">
                {FRAMES_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFramesPerSegment(f)}
                    className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                      framesPerSegment === f
                        ? 'bg-violet-700 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Pro gate / ControlNet download / Generate button */}
            {!isPro ? (
              <div className="shrink-0 bg-gray-900 border border-gray-700 rounded-xl p-4 text-center space-y-2">
                <div className="flex items-center justify-center gap-1.5 text-violet-400">
                  <Lock className="w-4 h-4" />
                  <span className="text-sm font-semibold">Pro Feature</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Pose Engine generates ControlNet-guided posed panels.
                  Upgrade to Pro to unlock pose-driven image generation.
                </p>
                <button className="w-full px-4 py-2 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors">
                  Upgrade to Pro — $19/month
                </button>
              </div>
            ) : showControlnetDownload ? (
              <div className="shrink-0 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-200">OpenPose ControlNet required</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Pose Engine needs the OpenPose ControlNet model (~1.4 GB).
                  Downloads once and is stored locally for all future sessions.
                </p>
                {downloadError && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {downloadError}
                  </p>
                )}
                {isDownloading ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                      <span>Downloading… {downloadMb} MB</span>
                      <span>{downloadProgress}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleDownloadControlnet}
                    className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Download OpenPose Model (~1.4 GB)
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`shrink-0 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  canGenerate
                    ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/40'
                    : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                }`}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {selectedIds.length === 0 ? 'Select at least one pose' : 'Generate Posed Panel'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
