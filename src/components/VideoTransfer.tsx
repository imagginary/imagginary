/**
 * Phase 6E — VideoTransfer (Gemini-assisted)
 *
 * Modal for uploading a reference video and transferring its motion onto a
 * panel via Gemini 1.5 Flash motion analysis + Seedance/Veo cloud generation.
 *
 * Flow:
 *   1. Drop zone → file selected, duration read via ffprobe
 *   2. Optional user description of the motion
 *   3. Engine choice + "Generate Motion Transfer" — Gemini analyzes the video,
 *      the description is combined with the user's prompt, and the result is
 *      sent to Seedance or Veo via the existing cloud animate path.
 *
 * Pro+ only — Community users see an upgrade prompt.
 */

import React, { useState } from 'react';
import { X, Upload, Film, Loader2, AlertCircle } from 'lucide-react';
import { Character, Panel } from '../types';
import { videoTransferService } from '../services/VideoTransferService';
import { comfyUIService } from '../services/ComfyUIService';
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

const MAX_DURATION_S = 5;

// ── Main component ────────────────────────────────────────────────────────────

export default function VideoTransfer({
  panel,
  isPro,
  onComplete,
  onClose,
  onUpgrade,
}: VideoTransferProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [engine, setEngine] = useState<'seedance' | 'seedance2' | 'veo'>('seedance');
  const [isGenerating, setIsGenerating] = useState(false);
  const [analysisStep, setAnalysisStep] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ── Pro gate (defense-in-depth — toolbar button already blocks Community users) ──
  if (!isPro) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-gray-950 border border-gray-800 rounded-xl max-w-sm w-full mx-4">
          <ProFeatureGate
            feature="Video Transfer"
            description="Upload a reference video and describe the motion. AI analyzes the movement and animates your panel to match — no skeleton setup needed."
            highlight="Powered by Gemini + Seedance · ~2 min · 35 credits"
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

  async function handleSelectVideo(filePath: string, displayName: string) {
    setError(null);
    setSelectedFilePath(filePath);
    setFileName(displayName);
    setVideoDuration(null);
    setValidating(true);
    try {
      const result = await videoTransferService.validateVideo(filePath);
      setVideoDuration(result.duration);
      if (result.rejectionReason) {
        setError(result.rejectionReason);
      } else if (result.duration > MAX_DURATION_S) {
        setError(`Video is ${result.duration.toFixed(1)}s — must be under ${MAX_DURATION_S} seconds.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read video metadata');
    } finally {
      setValidating(false);
    }
  }

  async function handleBrowseFile() {
    const result = await window.electronAPI!.showOpenDialog({
      title: 'Select Reference Video',
      filters: [{ name: 'Video', extensions: ['mp4', 'mov'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths?.length > 0) {
      const filePath = result.filePaths[0];
      const displayName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
      await handleSelectVideo(filePath, displayName);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = (file as any).path;
    if (filePath) {
      await handleSelectVideo(filePath, file.name);
    } else {
      await handleBrowseFile();
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────────

  const canGenerate =
    !!selectedFilePath &&
    !validating &&
    !isGenerating &&
    (videoDuration ?? 0) > 0 &&
    (videoDuration ?? 0) <= MAX_DURATION_S;

  async function handleGenerate() {
    if (!selectedFilePath || !canGenerate) return;
    setIsGenerating(true);
    setError(null);

    try {
      setAnalysisStep('Analyzing video movement…');
      const analysisResult = await window.electronAPI!.analyzeVideoMotion({
        videoPath: selectedFilePath,
      });

      if (analysisResult.error) throw new Error(analysisResult.error);

      const combinedPrompt = [analysisResult.motionDescription, userPrompt.trim()]
        .filter(Boolean)
        .join('. ');

      setAnalysisStep('Generating motion clip…');

      const onProgress = (_pct: number, msg: string) => setAnalysisStep(msg);
      const imageData = panel.generatedImageData ?? '';
      const result = engine === 'veo'
        ? await comfyUIService.animatePanelVeo(imageData, combinedPrompt, onProgress)
        : engine === 'seedance2'
          ? await comfyUIService.animatePanelSeedance2(imageData, combinedPrompt, onProgress)
          : await comfyUIService.animatePanelSeedance(imageData, combinedPrompt, onProgress);

      onComplete(result, null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video Transfer failed');
    } finally {
      setIsGenerating(false);
      setAnalysisStep('');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl flex flex-col w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Film className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-gray-100">Video Transfer</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-imagginary-900/60 text-imagginary-400 border border-imagginary-700/40 uppercase tracking-wide">Pro+</span>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-400 text-xs mb-4">
            Upload a reference video. AI will analyze the movement and animate your panel to match.
          </p>

          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 mb-4 bg-red-950/50 border border-red-700/50 rounded-lg text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={handleBrowseFile}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-violet-500 bg-violet-950/20'
                : 'border-gray-700 hover:border-blue-500'
            }`}
          >
            {validating ? (
              <>
                <Loader2 size={24} className="text-violet-400 mx-auto mb-2 animate-spin" />
                <p className="text-gray-300 text-sm">Reading video…</p>
              </>
            ) : (
              <>
                <Upload size={24} className="text-gray-500 mx-auto mb-2" />
                <p className="text-gray-300 text-sm">Drop video here or click to browse</p>
                <p className="text-gray-500 text-xs mt-1">MP4, MOV · Max {MAX_DURATION_S} seconds · 1080p recommended</p>
              </>
            )}
          </div>

          {/* Selected file info */}
          {selectedFilePath && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <Film size={12} />
              <span>{fileName}</span>
              {videoDuration !== null && (
                <>
                  <span className="text-gray-600">·</span>
                  <span>{videoDuration.toFixed(1)}s</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Prompt */}
        {selectedFilePath && (
          <div className="px-6 pb-4">
            <label className="text-xs font-medium text-gray-300 block mb-1.5">
              Describe the motion <span className="text-gray-500 font-normal">(optional — AI will auto-describe from video)</span>
            </label>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              disabled={isGenerating}
              placeholder="e.g. detective turns to face camera, dramatic reveal, zoom in on face"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none resize-none disabled:opacity-50"
              rows={2}
            />
            <p className="text-xs text-gray-600 mt-1">
              Your description is combined with AI's video analysis for best results
            </p>
          </div>
        )}

        {/* Engine selector + Generate button */}
        {selectedFilePath && (
          <div className="px-6 pb-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-gray-500">Engine:</span>
              <button
                onClick={() => setEngine('seedance')}
                disabled={isGenerating}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
                  engine === 'seedance' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Seedance 1.5 · ~2 min · 35 cr
              </button>
              <button
                onClick={() => setEngine('seedance2')}
                disabled={isGenerating}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
                  engine === 'seedance2' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Seedance 2.0 ✦ · ~2 min · 160 cr
              </button>
              <button
                onClick={() => setEngine('veo')}
                disabled={isGenerating}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
                  engine === 'veo' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Veo 3.1 ✦ · BYOK · ~1 min
              </button>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
            >
              {isGenerating && <Loader2 className="w-4 h-4 animate-spin" />}
              {isGenerating ? analysisStep || 'Working…' : 'Generate Motion Transfer'}
            </button>

            <p className="text-xs text-gray-600 text-center mt-2">
              {engine === 'veo'
                ? 'Billed to your Google account — no Imagginary credits charged'
                : `Credits deducted on completion · ${engine === 'seedance2' ? '160' : '35'} credits`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
