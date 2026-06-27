/**
 * Phase 6C — MotionLibrary
 *
 * Modal for browsing and applying motion clips to a storyboard panel.
 * Community users get 200 curated clips. Pro users can additionally
 * upload their own reference videos to extract custom motions.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  Header: title + GPU warning + close                  │
 *   ├────────────────────────────┬─────────────────────────┤
 *   │  Left: search + categories │  Right: clip detail      │
 *   │         + clip grid        │  (pose preview + apply)  │
 *   └────────────────────────────┴─────────────────────────┘
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Search, Upload, Play, Pause, Loader2, Film, Sparkles, AlertCircle, Lock, ChevronDown,
} from 'lucide-react';
import { MotionClip, MotionCategory, Panel } from '../types';
import { PoseKeyframe, SKELETON_CONNECTIONS } from '../data/PoseVocabulary';
import { motionLibraryService } from '../services/MotionLibraryService';
import { renderPoseToDataURL, expandSequence } from '../services/PoseEngineService';

// ── Category list ─────────────────────────────────────────────────────────────

const ALL_CATEGORIES: { id: MotionCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'walks', label: 'Walks' },
  { id: 'turns', label: 'Turns' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'reactions', label: 'Reactions' },
  { id: 'combat', label: 'Combat' },
  { id: 'emotional', label: 'Emotional' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'sports', label: 'Sports' },
  { id: 'dance', label: 'Dance' },
  { id: 'work', label: 'Work' },
  { id: 'sitting', label: 'Sitting' },
  { id: 'standing', label: 'Standing' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'crowd', label: 'Crowd' },
  { id: 'nature', label: 'Nature' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'animal', label: 'Animal' },
  { id: 'fight', label: 'Fight' },
  { id: 'chase', label: 'Chase' },
  { id: 'romance', label: 'Romance' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'horror', label: 'Horror' },
  { id: 'drama', label: 'Drama' },
  { id: 'action', label: 'Action' },
  { id: 'slow-motion', label: 'Slow-Mo' },
  { id: 'running', label: 'Running' },
  { id: 'falling', label: 'Falling' },
  { id: 'climbing', label: 'Climbing' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'driving', label: 'Driving' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface MotionLibraryProps {
  panel: Panel;
  isPro: boolean;
  comfyuiConnected: boolean;
  onApply: (params: { clipId: string; videoData: string }) => void;
  onClose: () => void;
}

// ── Animated stick figure (reuses PoseEditor SVG renderer) ───────────────────

interface StickFigureProps {
  keyframe: PoseKeyframe;
  width?: number;
  height?: number;
  dim?: boolean;
}

function StickFigure({ keyframe, width = 80, height = 108, dim = false }: StickFigureProps) {
  const joints = keyframe.joints;
  const opacity = dim ? 0.3 : 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ opacity }}
      aria-hidden="true"
    >
      {SKELETON_CONNECTIONS.map(([a, b], i) => {
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
      })}
      {joints.map((j, i) => {
        if (!j) return null;
        return (
          <circle
            key={i}
            cx={j.x * width}
            cy={j.y * height}
            r={i < 5 ? 3.5 : 2.5}
            fill="#a78bfa"
          />
        );
      })}
    </svg>
  );
}

// ── Clip thumbnail card ───────────────────────────────────────────────────────

interface ClipCardProps {
  clip: MotionClip;
  selected: boolean;
  onClick: () => void;
}

function ClipCard({ clip, selected, onClick }: ClipCardProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-1 rounded-lg border transition-all text-left group
        ${selected
          ? 'border-violet-500 bg-violet-900/20 shadow-lg shadow-violet-900/20'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/60'}`}
    >
      {/* Thumbnail */}
      <div className="relative w-full bg-gray-950 rounded-t-lg overflow-hidden flex items-center justify-center" style={{ aspectRatio: '4/5' }}>
        {clip.thumbnail ? (
          <img
            src={clip.thumbnail}
            alt={clip.name}
            className="w-full h-full object-contain p-2"
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <Film className="w-6 h-6 text-gray-700" />
          </div>
        )}

        {/* Confidence badge */}
        <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/60 rounded text-[9px] text-gray-400 backdrop-blur-sm">
          {clip.confidence}%
        </div>

        {/* Duration badge */}
        <div className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/60 rounded text-[9px] text-violet-300 backdrop-blur-sm">
          {clip.duration}s
        </div>

        {/* Custom badge */}
        {!clip.isStarter && !clip.poseSequencePath?.includes('user_') && (
          <div className="absolute top-1 left-1 px-1 py-0.5 bg-violet-900/80 border border-violet-700/60 rounded text-[9px] text-violet-300 backdrop-blur-sm">
            full
          </div>
        )}
        {clip.id.startsWith('user_') && (
          <div className="absolute top-1 left-1 px-1 py-0.5 bg-blue-900/80 border border-blue-700/60 rounded text-[9px] text-blue-300 backdrop-blur-sm">
            custom
          </div>
        )}
      </div>

      {/* Name */}
      <div className="px-1.5 pb-1.5">
        <p className={`text-[10px] font-medium truncate ${selected ? 'text-violet-300' : 'text-gray-300'}`}>
          {clip.name}
        </p>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MotionLibrary({
  panel,
  isPro,
  comfyuiConnected,
  onApply,
  onClose,
}: MotionLibraryProps) {
  const [clips, setClips] = useState<MotionClip[]>([]);
  const [filtered, setFiltered] = useState<MotionClip[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [activeCategory, setActiveCategory] = useState<MotionCategory | 'all'>('all');
  const [selectedClip, setSelectedClip] = useState<MotionClip | null>(null);
  const [selectedPoseSeq, setSelectedPoseSeq] = useState<PoseKeyframe[]>([]);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyMsg, setApplyMsg] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animFrameRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load library on mount
  useEffect(() => {
    motionLibraryService.loadLibrary().then((allClips) => {
      setClips(allClips);
      setFiltered(allClips);
      setIsLoading(false);
    });
  }, []);

  // Filter when category changes
  useEffect(() => {
    applyFilter(searchInput, activeCategory, clips);
  }, [activeCategory, clips]);

  // Pose sequence animation loop
  useEffect(() => {
    if (!isPlaying || selectedPoseSeq.length === 0) return;
    const expanded = expandSequence(selectedPoseSeq, 4); // short preview
    let frame = previewFrame;
    const tick = () => {
      frame = (frame + 1) % expanded.length;
      setPreviewFrame(frame);
      animFrameRef.current = setTimeout(tick, 125); // ~8fps
    };
    animFrameRef.current = setTimeout(tick, 125);
    return () => { if (animFrameRef.current) clearTimeout(animFrameRef.current); };
  }, [isPlaying, selectedPoseSeq]);

  // Load pose sequence when clip is selected
  useEffect(() => {
    if (!selectedClip) return;
    setSelectedPoseSeq([]);
    setPreviewFrame(0);
    setIsPlaying(false);
    motionLibraryService.getClipPoseSequence(selectedClip.id).then((seq) => {
      setSelectedPoseSeq(seq);
      setIsPlaying(true);
    }).catch(() => { /* pose unavailable */ });
  }, [selectedClip?.id]);

  function applyFilter(query: string, category: MotionCategory | 'all', source: MotionClip[]) {
    let result = source;
    if (category !== 'all') {
      result = result.filter((c) => c.category === category);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((t) => t.includes(q))
      );
    }
    setFiltered(result);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!value.trim()) {
      applyFilter('', activeCategory, clips);
      return;
    }

    // Debounce — first do local filter, then LLM semantic if needed
    applyFilter(value, activeCategory, clips);
    searchTimeoutRef.current = setTimeout(async () => {
      if (value.trim().length > 2) {
        try {
          const results = await motionLibraryService.searchClips(value);
          const cat = activeCategory === 'all' ? results : results.filter((c) => c.category === activeCategory);
          setFiltered(cat);
        } catch { /* keep local results */ }
      }
    }, 600);
  }

  async function handleApply() {
    if (!isPro) return; // gate enforced in UI; belt-and-suspenders guard
    if (!selectedClip || !panel.generatedImageData || !comfyuiConnected) return;
    setIsApplying(true);
    setApplyError(null);
    setApplyProgress(0);
    setApplyMsg('Starting…');
    try {
      const { videoData } = await motionLibraryService.applyClipToCharacter(
        selectedClip.id,
        panel.generatedImageData,
        (pct, msg) => { setApplyProgress(pct); setApplyMsg(msg); }
      );
      onApply({ clipId: selectedClip.id, videoData });
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsApplying(false);
    }
  }

  async function handleUploadVideo() {
    if (!isPro) return;
    const result = await (window as any).electronAPI?.showOpenDialog?.({
      title: 'Select Reference Video',
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm'] }],
      properties: ['openFile'],
    });
    if (result?.canceled || !result?.filePaths?.[0]) return;

    setIsUploading(true);
    try {
      const newClip = await motionLibraryService.uploadReferenceVideo(result.filePaths[0]);
      setClips((prev) => [newClip, ...prev]);
      setFiltered((prev) => [newClip, ...prev]);
      setSelectedClip(newClip);
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  }

  const expandedPreview = selectedPoseSeq.length > 0 ? expandSequence(selectedPoseSeq, 4) : [];
  const currentFrame = expandedPreview[previewFrame % Math.max(1, expandedPreview.length)];
  const canApply = isPro && !!selectedClip && !!panel.generatedImageData && comfyuiConnected && !isApplying;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[85vh] bg-gray-950 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0">
          <Film className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-gray-200">Motion Library</h2>
          <span className="text-[10px] text-gray-600 font-mono">
            {clips.length} clips{!comfyuiConnected && ' · GPU needed to apply'}
          </span>
          {!comfyuiConnected && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-yellow-950/50 border border-yellow-700/40 rounded text-[10px] text-yellow-400">
              <AlertCircle className="w-3 h-3" />
              ControlNet + GPU required to apply clips
            </div>
          )}
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">

          {/* Left column — search + categories + grid */}
          <div className="flex flex-col border-r border-gray-800 min-h-0" style={{ width: '60%' }}>

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-gray-800 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Describe the motion…"
                  className="w-full bg-gray-900 border border-gray-700 focus:border-violet-600 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Category pills */}
            <div className="px-4 py-2 border-b border-gray-800 shrink-0 overflow-x-auto">
              <div className="flex gap-1.5 min-w-max">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap
                      ${activeCategory === cat.id
                        ? 'bg-violet-700/40 text-violet-300 border border-violet-600/50'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'}`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clip grid */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-700">
                  <Film className="w-8 h-8 mb-2" />
                  <p className="text-sm">No clips match</p>
                  {searchInput && (
                    <button
                      onClick={() => { setSearchInput(''); applyFilter('', activeCategory, clips); }}
                      className="mt-2 text-xs text-violet-500 hover:text-violet-400"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {filtered.map((clip) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      selected={selectedClip?.id === clip.id}
                      onClick={() => setSelectedClip(clip)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Upload button (Pro only) */}
            <div className="px-4 py-3 border-t border-gray-800 shrink-0">
              {isPro ? (
                <button
                  onClick={handleUploadVideo}
                  disabled={isUploading}
                  className="flex items-center gap-2 w-full justify-center px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors disabled:opacity-50"
                >
                  {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {isUploading ? 'Extracting pose…' : 'Upload Reference Video (MP4/MOV)'}
                </button>
              ) : (
                <div className="flex items-center gap-2 w-full justify-center px-3 py-2 rounded-lg text-xs text-gray-600 border border-gray-800 cursor-not-allowed">
                  <Lock className="w-3 h-3 text-violet-500/40" />
                  Upload Reference Video — Pro only
                </div>
              )}
            </div>
          </div>

          {/* Right column — clip detail + apply */}
          <div className="flex-1 flex flex-col min-h-0 p-5 gap-4">
            {!selectedClip ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-700">
                <Sparkles className="w-10 h-10 mb-3" />
                <p className="text-sm font-medium">Select a clip</p>
                <p className="text-xs mt-1">Pick from the library to preview and apply</p>
              </div>
            ) : (
              <>
                {/* Clip info */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">{selectedClip.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{selectedClip.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="px-1.5 py-0.5 bg-gray-800 rounded text-[9px] text-gray-400 font-mono">{selectedClip.category}</span>
                    <span className="px-1.5 py-0.5 bg-gray-800 rounded text-[9px] text-gray-400">{selectedClip.duration}s</span>
                    <span className="px-1.5 py-0.5 bg-gray-800 rounded text-[9px] text-gray-400">{selectedClip.confidence}% confidence</span>
                    {selectedClip.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 bg-violet-900/30 border border-violet-800/30 rounded text-[9px] text-violet-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Pose sequence preview */}
                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wide">Pose Preview</span>
                    {selectedPoseSeq.length > 0 && (
                      <button
                        onClick={() => setIsPlaying((v) => !v)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                      >
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        {isPlaying ? 'Pause' : 'Play'}
                      </button>
                    )}
                  </div>

                  {/* Animated stick figure */}
                  <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg flex flex-col items-center justify-center gap-2 min-h-0 relative overflow-hidden">
                    {selectedPoseSeq.length === 0 ? (
                      <div className="flex items-center justify-center text-gray-700">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                    ) : currentFrame ? (
                      <>
                        <StickFigure keyframe={currentFrame} width={120} height={160} />
                        {/* Frame strip at bottom */}
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 px-3">
                          {expandedPreview.slice(0, Math.min(expandedPreview.length, 12)).map((kf, i) => (
                            <button
                              key={i}
                              onClick={() => { setIsPlaying(false); setPreviewFrame(i); }}
                              className={`w-4 h-8 rounded border transition-all overflow-hidden ${
                                i === previewFrame % Math.min(expandedPreview.length, 12)
                                  ? 'border-violet-500 bg-violet-900/40'
                                  : 'border-gray-700 bg-gray-900 hover:border-gray-600'
                              }`}
                            >
                              <img
                                src={renderPoseToDataURL(kf, 20, 28)}
                                alt=""
                                className="w-full h-full object-contain"
                                draggable={false}
                              />
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Apply panel */}
                <div className="flex flex-col gap-2 shrink-0">
                  {!isPro ? (
                    /* Community gate */
                    <div className="rounded-xl border border-violet-800/40 bg-violet-950/20 p-4 text-center space-y-2">
                      <div className="flex items-center justify-center gap-1.5 text-violet-400">
                        <Lock className="w-4 h-4" />
                        <span className="text-sm font-semibold">Pro Feature</span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Motion generation needs a 14B model (~14 GB) — Pro generates in the cloud in under 60 seconds.
                      </p>
                      <button
                        onClick={() => (window as any).electronAPI?.openExternal?.('https://imagginary.com/upgrade')}
                        className="w-full px-4 py-2 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors"
                      >
                        Upgrade to Pro — $19/month
                      </button>
                    </div>
                  ) : (
                    <>
                      {applyError && (
                        <div className="flex items-start gap-2 px-3 py-2 bg-red-950/50 border border-red-800/50 rounded text-xs text-red-400">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          {applyError}
                        </div>
                      )}

                      {isApplying && (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px] text-gray-500">
                            <span>{applyMsg}</span>
                            <span>{applyProgress.toFixed(1)}%</span>
                          </div>
                          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-violet-500 rounded-full transition-all duration-300"
                              style={{ width: `${applyProgress}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-gray-600">
                            Wan 2.2 via ControlNet · ~3–5 min on Apple Silicon
                          </p>
                        </div>
                      )}

                      {!comfyuiConnected && (
                        <p className="text-[10px] text-yellow-600 text-center">
                          ComfyUI + ControlNet required to apply motion clips
                        </p>
                      )}

                      <button
                        onClick={handleApply}
                        disabled={!canApply}
                        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold
                          bg-violet-600 hover:bg-violet-500 text-white transition-colors
                          disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isApplying ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                        ) : (
                          <><Film className="w-4 h-4" /> Apply to Panel</>
                        )}
                      </button>

                      {!panel.generatedImageData && (
                        <p className="text-[10px] text-gray-600 text-center">
                          Generate a panel image first to apply motion
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
