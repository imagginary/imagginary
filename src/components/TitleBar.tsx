import React, { useState } from 'react';
import { Film, Save, FolderOpen, Plus, Video, Loader2, HelpCircle, Settings, ScrollText, FileText, FileCode, Lock, X, Clapperboard, Star, Zap, Users } from 'lucide-react';
import { ServiceStatus } from '../types';

interface TitleBarProps {
  projectTitle: string;
  serviceStatus: ServiceStatus;
  onNewProject: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  onGenerateAnimatic: () => void;
  onExportMotionComic: () => void;
  onOpenScriptReader: () => void;
  onSetup: () => void;
  onOpenSettings: () => void;
  onExportPDF: () => void;
  onExportXML: () => void;
  isSaving: boolean;
  isExporting: boolean;
  exportProgress: number | null;
  isStudio?: boolean;
  onActivateLicense?: () => void;
  isSharedSession?: boolean;
  onStartSharedSession?: () => void;
  isExportingMotionComic: boolean;
  motionComicProgress: number;
  hasMotionClips: boolean;
}

function ConnectionDot({ status }: { status: 'checking' | 'connected' | 'disconnected' | 'error' }) {
  const color =
    status === 'connected'
      ? 'bg-green-400'
      : status === 'checking'
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-red-500';
  return <span className={`w-2 h-2 rounded-full inline-block ${color}`} />;
}

function StudioUpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-gray-600 hover:text-gray-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <FileText className="w-8 h-8 text-imagginary-400 mx-auto mb-3" />
        <p className="text-sm text-gray-200 font-semibold mb-2">Production Pack</p>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          PDF storyboard export and Premiere Pro XML export are Studio features. Export your boards straight into your edit.
        </p>
        <button className="w-full px-4 py-2 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors mb-3">
          Upgrade to Studio
        </button>
        <button
          onClick={onClose}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

export default function TitleBar({
  projectTitle,
  serviceStatus,
  onNewProject,
  onSaveProject,
  onLoadProject,
  onGenerateAnimatic,
  onExportMotionComic,
  onOpenScriptReader,
  onSetup,
  onOpenSettings,
  onExportPDF,
  onExportXML,
  isSaving,
  isExporting,
  exportProgress,
  isStudio = false,
  onActivateLicense,
  isExportingMotionComic,
  motionComicProgress,
  hasMotionClips,
  isSharedSession = false,
  onStartSharedSession,
}: TitleBarProps) {
  const [showUpgrade, setShowUpgrade] = useState(false);

  function handleExportPDF() {
    if (!isStudio) { onActivateLicense ? onActivateLicense() : setShowUpgrade(true); return; }
    onExportPDF();
  }

  function handleExportXML() {
    if (!isStudio) { onActivateLicense ? onActivateLicense() : setShowUpgrade(true); return; }
    onExportXML();
  }

  return (
    <>
      <div
        className="flex items-center justify-between px-4 h-11 bg-gray-950 border-b border-gray-800 select-none shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left — app identity */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Film className="w-4 h-4 text-imagginary-400" />
          <span className="text-xs font-semibold text-imagginary-400 tracking-widest uppercase">Imagginary</span>
          <span className="text-gray-600 text-xs">|</span>
          <span className="text-sm text-gray-200 font-medium truncate max-w-[240px]">{projectTitle}</span>
        </div>

        {/* Center — service status */}
        <div
          className="flex items-center gap-4 text-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-1.5 text-gray-400">
            <ConnectionDot status={serviceStatus.ollama} />
            <span>Ollama</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <ConnectionDot status={serviceStatus.comfyui} />
            <span>ComfyUI</span>
            {serviceStatus.comfyui === 'disconnected' && (
              <span className="text-red-400 text-[10px]">— start on :8188</span>
            )}
          </div>
          <div
            className="flex items-center gap-1.5 text-gray-400"
            title={serviceStatus.instantmesh === 'disconnected' ? 'Character multi-view disabled — start InstantMesh on :7860' : 'InstantMesh ready'}
          >
            <ConnectionDot status={serviceStatus.instantmesh} />
            <span>InstantMesh</span>
            {serviceStatus.instantmesh === 'disconnected' && (
              <span className="text-gray-600 text-[10px]">— optional</span>
            )}
          </div>
        </div>

        {/* Right — actions */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={onNewProject}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="New Project"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>

          <button
            onClick={onLoadProject}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Open Project"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open
          </button>

          <button
            onClick={onSaveProject}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors disabled:opacity-40"
            title="Save Project"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </button>

          <button
            onClick={onOpenScriptReader}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Script Reader — paste a screenplay to generate a full storyboard"
          >
            <ScrollText className="w-3.5 h-3.5" />
            Script
          </button>

          <button
            onClick={onSetup}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Setup / Getting started"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Settings — API keys & cloud integrations"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {isStudio && (
            <button
              onClick={onStartSharedSession}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                isSharedSession
                  ? 'text-green-400 hover:text-green-300 hover:bg-green-900/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
              title="Shared Studio — collaborate in real time"
            >
              <Users className="w-3.5 h-3.5" />
              {isSharedSession && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400" />
              )}
            </button>
          )}

          <div className="w-px h-4 bg-gray-700 mx-1" />

          {/* License / tier indicator */}
          {isStudio ? (
            <button
              onClick={onActivateLicense}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase text-violet-300 hover:text-violet-200 hover:bg-violet-900/20 transition-colors"
              title="Studio — manage license"
            >
              <Star className="w-3 h-3" /> Studio
            </button>
          ) : (
            <button
              onClick={onActivateLicense}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase text-imagginary-400 hover:text-imagginary-300 hover:bg-imagginary-900/20 transition-colors"
              title="Upgrade to Pro or Studio"
            >
              <Zap className="w-3 h-3" /> Upgrade
            </button>
          )}

          <div className="w-px h-4 bg-gray-700 mx-1" />

          {/* Production Pack — Studio exports */}
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title={isStudio ? 'Export PDF storyboard' : 'Export PDF — Studio feature'}
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
            {!isStudio && <Lock className="w-2.5 h-2.5 text-imagginary-500/60" />}
          </button>

          <button
            onClick={handleExportXML}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title={isStudio ? 'Export Premiere Pro XML' : 'Export XML — Studio feature'}
          >
            <FileCode className="w-3.5 h-3.5" />
            XML
            {!isStudio && <Lock className="w-2.5 h-2.5 text-imagginary-500/60" />}
          </button>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          <button
            onClick={onGenerateAnimatic}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-imagginary-600 hover:bg-imagginary-500 text-black font-semibold transition-colors disabled:opacity-40 min-w-[90px]"
            title="Export Animatic as MP4"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                {exportProgress !== null && exportProgress > 0
                  ? `${exportProgress}%`
                  : 'Encoding…'}
              </>
            ) : (
              <>
                <Video className="w-3.5 h-3.5 shrink-0" />
                Animatic
              </>
            )}
          </button>

          <button
            onClick={onExportMotionComic}
            disabled={isExportingMotionComic || !hasMotionClips}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-purple-700 hover:bg-purple-600 text-white font-semibold transition-colors disabled:opacity-40"
            title={!hasMotionClips ? 'Animate panels first' : 'Export Motion Comic (Phase 6D)'}
          >
            {isExportingMotionComic ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                {motionComicProgress > 0 ? `${motionComicProgress}%` : 'Exporting…'}
              </>
            ) : (
              <>
                <Clapperboard className="w-3.5 h-3.5 shrink-0" />
                Motion Comic
              </>
            )}
          </button>
        </div>
      </div>

      {showUpgrade && <StudioUpgradeModal onClose={() => setShowUpgrade(false)} />}
    </>
  );
}
