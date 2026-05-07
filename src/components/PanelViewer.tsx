import React, { useRef, useState, useEffect } from 'react';
import { ImageOff, Loader2, AlertCircle, Pencil, X, Undo2, Trash2, Check, Film, RefreshCw, History, Columns2, RotateCcw, ChevronLeft, Lock } from 'lucide-react';
import { Panel, PanelRevision, GenerationProgress } from '../types';
import { AspectRatio, getAspectRatio, DEFAULT_ASPECT_RATIO_ID } from '../data/AspectRatios';

interface PanelViewerProps {
  panel: Panel | null;
  progress: GenerationProgress | null;
  effectiveAspectRatio?: AspectRatio;
  onInpaintEdit?: (panelId: string, maskData: string, editDescription: string) => void;
  onUndoEdit?: (panelId: string) => void;
  onAnimatePanel?: (panelId: string, motionDescription: string) => void;
  onClearMotion?: (panelId: string) => void;
  onRestoreRevision?: (panelId: string, revision: PanelRevision) => void;
  comfyuiConnected?: boolean;
  wanModelAvailable?: boolean | null;
  wanModelWarning?: string;
  isPro?: boolean;
}

const BRUSH_SIZES = [8, 16, 28, 44];

const MOTION_PLACEHOLDERS: Record<string, string> = {
  dramatic: 'slow push in, wind moving through scene, dramatic atmosphere',
  joyful: 'gentle camera drift, warm light flickering, celebratory movement',
  tense: 'handheld shake, tight zoom, tension broken by sudden movement',
  melancholic: 'slow dolly back, fading light, leaves drifting to ground',
  mysterious: 'slow pan revealing shadows, fog rolling in, uneasy stillness',
  romantic: 'gentle bokeh drift, warm light pulse, soft focus camera float',
  horrifying: 'sudden rack focus, erratic movement, harsh light flicker',
  comedic: 'whip pan, bouncy camera, bright light pop',
  serene: 'slow drift across landscape, gentle breeze, peaceful stillness',
  chaotic: 'rapid motion, handheld chaos, strobing light',
  neutral: 'slow pan, steady camera drift, subtle environmental movement',
};

function getMotionPlaceholder(mood: string | null): string {
  return MOTION_PLACEHOLDERS[mood ?? ''] ?? 'Describe the motion: camera movement, subject action, atmosphere...';
}

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function PanelViewer({
  panel,
  progress,
  effectiveAspectRatio,
  onInpaintEdit,
  onUndoEdit,
  onAnimatePanel,
  onClearMotion,
  onRestoreRevision,
  comfyuiConnected,
  wanModelAvailable,
  wanModelWarning,
  isPro = false,
}: PanelViewerProps) {
  const aspectRatio = effectiveAspectRatio ?? getAspectRatio(DEFAULT_ASPECT_RATIO_ID);
  const isGenerating =
    progress !== null &&
    progress.panelId === panel?.id &&
    progress.status !== 'complete' &&
    progress.status !== 'error';

  const isAnimating = progress?.panelId === panel?.id && progress?.status === 'animating';
  const hasError = progress?.status === 'error' && progress.panelId === panel?.id;

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [brushSizeIdx, setBrushSizeIdx] = useState(1);
  const [editDescription, setEditDescription] = useState('');
  const [hasMask, setHasMask] = useState(false);

  // Animate mode state
  const [animateMode, setAnimateMode] = useState(false);
  const [motionInput, setMotionInput] = useState('');

  // History / compare state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [compareRevisionId, setCompareRevisionId] = useState<string | null>(null);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const brushSize = BRUSH_SIZES[brushSizeIdx];

  // Reset all modes when panel changes
  useEffect(() => {
    setEditMode(false);
    setEditDescription('');
    setHasMask(false);
    setAnimateMode(false);
    setMotionInput('');
    setHistoryOpen(false);
    setCompareRevisionId(null);
  }, [panel?.id]);

  // Pre-fill motion input from saved description when opening animate mode
  useEffect(() => {
    if (animateMode && panel?.motionDescription) {
      setMotionInput(panel.motionDescription);
    }
  }, [animateMode]);

  // Clear canvas when entering edit mode
  useEffect(() => {
    if (editMode && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHasMask(false);
    }
  }, [editMode]);

  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function drawStroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    setHasMask(true);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!editMode) return;
    isDrawing.current = true;
    const pos = getCanvasPos(e);
    if (!pos) return;
    lastPos.current = pos;
    drawStroke(pos, pos);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!editMode || !isDrawing.current) return;
    const pos = getCanvasPos(e);
    if (!pos || !lastPos.current) return;
    drawStroke(lastPos.current, pos);
    lastPos.current = pos;
  }

  function handleMouseUp() {
    isDrawing.current = false;
    lastPos.current = null;
  }

  function handleClearMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasMask(false);
  }

  /** Export mask: white = painted (change), black = untouched (preserve) */
  function exportMask(): string {
    const canvas = canvasRef.current;
    if (!canvas) return '';

    const W = aspectRatio.width;
    const H = aspectRatio.height;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = W;
    exportCanvas.height = H;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, W, H);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return '';

    const srcData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const dstData = tempCtx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < srcData.data.length; i += 4) {
      const alpha = srcData.data[i + 3];
      const val = alpha > 0 ? 255 : 0;
      dstData.data[i] = val;
      dstData.data[i + 1] = val;
      dstData.data[i + 2] = val;
      dstData.data[i + 3] = 255;
    }
    tempCtx.putImageData(dstData, 0, 0);

    ctx.drawImage(tempCanvas, 0, 0, W, H);
    return exportCanvas.toDataURL('image/png');
  }

  function handleApplyEdit() {
    if (!panel || !hasMask || !editDescription.trim() || !onInpaintEdit) return;
    const maskData = exportMask();
    onInpaintEdit(panel.id, maskData, editDescription.trim());
    setEditMode(false);
    setEditDescription('');
    setHasMask(false);
  }

  function handleGenerateMotion() {
    if (!panel || !motionInput.trim() || !onAnimatePanel || isGenerating) return;
    onAnimatePanel(panel.id, motionInput.trim());
  }

  function handleOpenHistory() {
    setEditMode(false);
    setAnimateMode(false);
    setHasMask(false);
    setHistoryOpen(true);
    setCompareRevisionId(null);
  }

  function handleCloseHistory() {
    setHistoryOpen(false);
    setCompareRevisionId(null);
  }

  function handleRestore(revision: PanelRevision) {
    if (!panel) return;
    onRestoreRevision?.(panel.id, revision);
    handleCloseHistory();
  }

  const revisions = panel?.revisions ?? [];
  // Newest first for display
  const revisionsNewestFirst = [...revisions].reverse();
  const compareRevision = compareRevisionId
    ? revisions.find((r) => r.id === compareRevisionId) ?? null
    : null;

  const canEdit = !!panel?.generatedImageData && !isGenerating;
  const canUndo = (panel?.editHistory?.length ?? 0) > 0 && !isGenerating;
  const canAnimate = !!panel?.generatedImageData;
  const hasClip = !!(panel?.motionClipData || panel?.motionClipPath);
  const hasRevisions = revisions.length > 0;

  // ── Pro gate for history ─────────────────────────────────────────────────────
  if (historyOpen && !isPro) {
    return (
      <div className="relative flex-1 flex flex-col items-center justify-center bg-gray-950 min-h-0 p-6">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-xs text-center shadow-2xl">
          <History className="w-8 h-8 text-imagginary-400 mx-auto mb-3" />
          <p className="text-sm text-gray-200 font-semibold mb-2">Revision History</p>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Full panel revision history and version compare is a Pro feature. See every version, compare side-by-side, and restore any previous version.
          </p>
          <button className="w-full px-4 py-2 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors mb-3">
            Upgrade to Pro — $19/month
          </button>
          <button
            onClick={handleCloseHistory}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    );
  }

  // ── Compare mode ────────────────────────────────────────────────────────────
  if (historyOpen && compareRevision && panel) {
    return (
      <div className="relative flex-1 flex flex-col bg-gray-950 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0">
          <button
            onClick={() => setCompareRevisionId(null)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <span className="text-xs text-gray-400 font-medium">Compare Versions</span>
        </div>

        {/* Split view */}
        <div className="flex-1 flex gap-3 p-4 min-h-0 overflow-hidden">
          {/* Left — selected revision */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wide">
                {compareRevision.label ?? formatTimestamp(compareRevision.timestamp)}
              </span>
              <span className="text-[10px] text-gray-600">{formatTimestamp(compareRevision.timestamp)}</span>
            </div>
            <div
              className="flex-1 bg-gray-900 rounded-lg overflow-hidden border border-gray-800 min-h-0"
              style={{ aspectRatio: aspectRatio.cssRatio, maxHeight: '100%' }}
            >
              <img
                src={compareRevision.imageData}
                alt="Previous version"
                className="w-full h-full object-contain"
                draggable={false}
              />
            </div>
            {compareRevision.prompt && (
              <p className="text-[10px] text-gray-600 px-1 truncate" title={compareRevision.prompt}>
                {compareRevision.prompt}
              </p>
            )}
            <button
              onClick={() => handleRestore(compareRevision)}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Restore this version
            </button>
          </div>

          {/* Right — current version */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-imagginary-400 font-mono uppercase tracking-wide">Current</span>
            </div>
            <div
              className="flex-1 bg-gray-900 rounded-lg overflow-hidden border border-imagginary-800/50 min-h-0"
              style={{ aspectRatio: aspectRatio.cssRatio, maxHeight: '100%' }}
            >
              {panel.generatedImageData ? (
                <img
                  src={panel.generatedImageData}
                  alt="Current version"
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-700">
                  <ImageOff className="w-8 h-8" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── History drawer ───────────────────────────────────────────────────────────
  if (historyOpen) {
    return (
      <div className="relative flex-1 flex flex-col bg-gray-950 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-300 font-medium">Revision History</span>
            <span className="text-[10px] text-gray-600 font-mono">({revisions.length}/20)</span>
          </div>
          <button
            onClick={handleCloseHistory}
            className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Revision grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {revisionsNewestFirst.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-700">
              <History className="w-8 h-8 mb-2" />
              <p className="text-xs">No revisions yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {revisionsNewestFirst.map((rev, idx) => (
                <div key={rev.id} className="flex flex-col gap-1.5">
                  <div className="relative bg-gray-900 rounded-lg overflow-hidden border border-gray-800 hover:border-gray-700 transition-colors">
                    <img
                      src={rev.imageData}
                      alt={`Revision ${revisions.length - idx}`}
                      className="w-full object-contain"
                      style={{ aspectRatio: aspectRatio.cssRatio }}
                      draggable={false}
                    />
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-gray-400 font-mono">
                      v{revisions.length - idx}
                    </div>
                  </div>
                  <div className="px-0.5">
                    <p className="text-[10px] text-gray-500">{formatTimestamp(rev.timestamp)}</p>
                    {rev.prompt && (
                      <p className="text-[10px] text-gray-600 truncate mt-0.5" title={rev.prompt}>
                        {rev.prompt}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleRestore(rev)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors"
                      title="Restore this version"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      Restore
                    </button>
                    <button
                      onClick={() => setCompareRevisionId(rev.id)}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors"
                      title="Compare with current"
                    >
                      <Columns2 className="w-2.5 h-2.5" />
                      Compare
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Normal view ──────────────────────────────────────────────────────────────
  return (
    <div className="relative flex-1 flex flex-col items-center justify-center bg-gray-950 min-h-0">
      {/* Panel image / video area */}
      <div className="w-full h-full flex items-center justify-center p-6 min-h-0">
        <div
          ref={imageContainerRef}
          className="relative bg-gray-900 rounded-lg overflow-hidden shadow-2xl border border-gray-800"
          style={{ aspectRatio: aspectRatio.cssRatio, maxHeight: '100%', maxWidth: '100%', width: '100%' }}
        >
          {/* Motion clip — shown in main viewport when animate mode is active and clip exists */}
          {animateMode && hasClip && !isGenerating && (panel?.motionClipData || panel?.motionClipPath) && (
            <video
              key={panel?.motionClipData ?? panel?.motionClipPath ?? ''}
              src={panel?.motionClipData ?? undefined}
              autoPlay
              loop
              muted
              controls
              className="w-full h-full object-contain"
            />
          )}

          {/* Generated image — shown when no active video */}
          {panel?.generatedImageData && !isGenerating && !(animateMode && hasClip) && (
            <img
              src={panel.generatedImageData}
              alt={panel.shotDescription}
              className="w-full h-full object-contain"
              draggable={false}
            />
          )}

          {/* Paint canvas overlay — only when in edit mode with an image */}
          {editMode && panel?.generatedImageData && (
            <canvas
              ref={canvasRef}
              width={aspectRatio.width}
              height={aspectRatio.height}
              className="absolute inset-0 w-full h-full"
              style={{
                cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${brushSize}' height='${brushSize}'%3E%3Ccircle cx='${brushSize / 2}' cy='${brushSize / 2}' r='${brushSize / 2 - 1}' fill='rgba(255,80,80,0.5)' stroke='white' stroke-width='1'/%3E%3C/svg%3E") ${brushSize / 2} ${brushSize / 2}, crosshair`,
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          )}

          {/* Empty state */}
          {!panel && !isGenerating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-700">
              <ImageOff className="w-16 h-16 mb-4" />
              <p className="text-sm">Select or create a panel</p>
              <p className="text-xs mt-1 text-gray-800">Describe a shot and click Generate</p>
            </div>
          )}

          {/* No image yet */}
          {panel && !panel.generatedImageData && !isGenerating && !hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-700">
              <ImageOff className="w-12 h-12 mb-3" />
              <p className="text-sm">No image generated yet</p>
              <p className="text-xs mt-1 text-gray-800">Describe the shot below and click Generate</p>
            </div>
          )}

          {/* Loading overlay */}
          {isGenerating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 z-10">
              {panel?.generatedImageData && (
                <img
                  src={panel.generatedImageData}
                  alt=""
                  className="absolute inset-0 w-full h-full object-contain opacity-20"
                />
              )}
              <div className="relative z-20 flex flex-col items-center gap-4">
                <Loader2 className={`w-10 h-10 animate-spin ${isAnimating ? 'text-violet-400' : 'text-imagginary-400'}`} />
                <div className="text-center">
                  <p className={`text-sm font-medium ${isAnimating ? 'text-violet-400' : 'text-imagginary-400'}`}>
                    {progress?.message}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {progress?.status === 'parsing'
                      ? 'LLM parsing...'
                      : progress?.status === 'animating'
                        ? '~3–8 min on Apple Silicon · Faster in Pro via cloud'
                        : 'ComfyUI generating...'}
                  </p>
                </div>
                <div className="w-48 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${isAnimating ? 'bg-violet-500' : 'bg-imagginary-500'}`}
                    style={{ width: `${progress?.progress ?? 0}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 font-mono">{progress?.progress ?? 0}%</p>
                {isAnimating && (
                  <p className="text-[10px] text-gray-600 text-center max-w-48">
                    Wan 2.2 generation takes 3–5 minutes locally.
                    Keep this window open.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 z-10">
              <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
              <p className="text-sm text-red-400 font-medium">{progress?.message ?? 'Generation Failed'}</p>
              <p className="text-xs text-gray-500 mt-1 px-6 text-center">{progress?.error}</p>
              {progress?.errorLink && (
                <button
                  className="mt-3 text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2"
                  onClick={() => (window as any).electronAPI?.openExternal(progress.errorLink!.url)}
                >
                  {progress.errorLink.label}
                </button>
              )}
            </div>
          )}

          {/* Panel number badge */}
          {panel && (
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-xs text-gray-400 font-mono backdrop-blur-sm">
              #{String((panel.order ?? 0) + 1).padStart(2, '0')}
            </div>
          )}

          {/* Duration badge */}
          {panel?.duration && (
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 rounded text-xs text-gray-400 backdrop-blur-sm">
              {panel.duration}s
            </div>
          )}

          {/* Motion clip indicator badge */}
          {hasClip && !animateMode && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-violet-900/70 border border-violet-700/50 rounded text-[10px] text-violet-300 backdrop-blur-sm flex items-center gap-1">
              <Film className="w-2.5 h-2.5" />
              clip
            </div>
          )}

          {/* Edit mode toolbar — bottom center inside image */}
          {editMode && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/75 backdrop-blur-sm rounded-lg px-3 py-1.5 z-20">
              <span className="text-[10px] text-gray-400 mr-1">Brush</span>
              {BRUSH_SIZES.map((size, idx) => (
                <button
                  key={size}
                  onClick={() => setBrushSizeIdx(idx)}
                  className={`rounded-full transition-all ${
                    idx === brushSizeIdx ? 'bg-imagginary-500' : 'bg-gray-600 hover:bg-gray-500'
                  }`}
                  style={{ width: size / 2 + 8, height: size / 2 + 8 }}
                  title={`Brush size ${size}px`}
                />
              ))}
              <div className="w-px h-4 bg-gray-600 mx-1" />
              <button
                onClick={handleClearMask}
                disabled={!hasMask}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-300 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-30"
                title="Clear mask"
              >
                <Trash2 className="w-3 h-3" />
              </button>
              <button
                onClick={() => { setEditMode(false); setHasMask(false); }}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                title="Cancel"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar row — Edit Region + Animate + History buttons */}
      {(canEdit || canAnimate || hasRevisions) && !isGenerating && (
        <div className="w-full px-6 pb-1 flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => { setEditMode((v) => !v); setAnimateMode(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                editMode
                  ? 'bg-red-600/20 text-red-400 border border-red-600/40 hover:bg-red-600/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
              title="Paint a region to edit"
            >
              <Pencil className="w-3 h-3" />
              {editMode ? 'Editing…' : 'Edit Region'}
            </button>
          )}

          {canAnimate && (
            <button
              onClick={() => { setAnimateMode((v) => !v); setEditMode(false); setHasMask(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                animateMode
                  ? 'bg-violet-600/20 text-violet-400 border border-violet-600/40 hover:bg-violet-600/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
              title={
                comfyuiConnected && !hasClip
                  ? 'Requires Wan 2.2 — see docs/INSTANTMESH_SETUP.md for setup guide'
                  : hasClip
                    ? 'View or regenerate motion clip'
                    : 'Generate a motion clip from this panel'
              }
            >
              <Film className="w-3 h-3" />
              {animateMode ? 'Animating…' : hasClip ? 'Clip Ready' : 'Animate'}
            </button>
          )}

          {canUndo && (
            <button
              onClick={() => onUndoEdit?.(panel!.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title="Undo last edit"
            >
              <Undo2 className="w-3 h-3" />
              Undo Edit
            </button>
          )}

          {hasRevisions && (
            <button
              onClick={handleOpenHistory}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors ml-auto"
              title={isPro ? 'View revision history' : 'Revision history — Pro feature'}
            >
              <History className="w-3 h-3" />
              History ({revisions.length})
              {!isPro && <Lock className="w-2.5 h-2.5 text-imagginary-500/60" />}
            </button>
          )}
        </div>
      )}

      {/* Edit description input */}
      {editMode && (
        <div className="w-full px-6 pb-3 flex items-center gap-2">
          <input
            type="text"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApplyEdit()}
            placeholder="What should change here?"
            autoFocus
            className="flex-1 bg-gray-800 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors"
          />
          <button
            onClick={handleApplyEdit}
            disabled={!hasMask || !editDescription.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold bg-imagginary-600 hover:bg-imagginary-500 text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Apply edit"
          >
            <Check className="w-3.5 h-3.5" />
            Apply Edit
          </button>
        </div>
      )}

      {/* Animate panel — expands below toolbar when animateMode is active */}
      {animateMode && (
        <div className="w-full px-6 pb-3 flex flex-col gap-2">
          {wanModelAvailable === false ? (
            /* No local model — show upgrade prompt */
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-300 font-medium mb-1">Motion generation requires Pro</p>
              <p className="text-xs text-gray-500 mb-3">
                Local motion needs a 14B model (~14GB) — too large for most machines.
                Pro generates in the cloud in under 60 seconds.
              </p>
              <button className="px-4 py-2 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors">
                Upgrade to Pro — $19/month
              </button>
              <p className="text-xs text-gray-600 mt-2">
                Have a powerful GPU?{' '}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); }}
                  className="text-imagginary-600 underline"
                >
                  Set up local generation →
                </a>
              </p>
            </div>
          ) : (
            /* Local model available (or still checking) — show generation UI */
            <>
              {/* Existing clip controls */}
              {hasClip && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-violet-400 font-mono flex items-center gap-1">
                    <Film className="w-2.5 h-2.5" />
                    Clip generated
                  </span>
                  <button
                    onClick={() => panel && onClearMotion?.(panel.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
                    title="Clear motion clip"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    Clear
                  </button>
                </div>
              )}

              {/* Low-memory warning */}
              {wanModelWarning === 'low_memory' && (
                <div className="flex items-start gap-2 px-3 py-2 bg-yellow-950/60 border border-yellow-700/50 rounded text-xs text-yellow-300">
                  <span className="mt-px">⚠️</span>
                  <span>
                    Generation may fail on 32 GB machines. For best results start ComfyUI with{' '}
                    <code className="font-mono text-yellow-200">PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0</code>.
                  </span>
                </div>
              )}

              {/* Motion description textarea */}
              <textarea
                rows={2}
                value={motionInput}
                onChange={(e) => setMotionInput(e.target.value)}
                placeholder={getMotionPlaceholder(panel?.mood ?? null)}
                className="w-full bg-gray-800 border border-gray-700 focus:border-violet-500 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors resize-none"
              />

              {/* Duration info */}
              <p className="text-[10px] text-gray-600">
                Duration: ~1 second · Wan 2.1 I2V 14B fp8 · ~3–8 min on Apple Silicon
              </p>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateMotion}
                  disabled={!motionInput.trim() || isGenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {hasClip ? (
                    <>
                      <RefreshCw className="w-3 h-3" />
                      Regenerate Motion
                    </>
                  ) : (
                    <>
                      <Film className="w-3 h-3" />
                      Generate Motion
                    </>
                  )}
                </button>
                <button
                  onClick={() => setAnimateMode(false)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Structured prompt tags */}
      {panel?.structuredPrompt && !isGenerating && !editMode && !animateMode && (
        <div className="px-6 pb-2 w-full">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {[
              panel.structuredPrompt.shotType,
              panel.structuredPrompt.angle,
              panel.structuredPrompt.mood,
              panel.structuredPrompt.timeOfDay,
            ]
              .filter(Boolean)
              .map((tag, i) => (
                <span key={i} className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px] font-mono">
                  {tag}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
