import React from 'react';
import { Film, Save, FolderOpen, Plus, Video, Loader2, HelpCircle, ScrollText } from 'lucide-react';
import { ServiceStatus } from '../types';

interface TitleBarProps {
  projectTitle: string;
  serviceStatus: ServiceStatus;
  onNewProject: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  onGenerateAnimatic: () => void;
  onOpenScriptReader: () => void;
  onSetup: () => void;
  isSaving: boolean;
  isExporting: boolean;
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

export default function TitleBar({
  projectTitle,
  serviceStatus,
  onNewProject,
  onSaveProject,
  onLoadProject,
  onGenerateAnimatic,
  onOpenScriptReader,
  onSetup,
  isSaving,
  isExporting,
}: TitleBarProps) {
  return (
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

        <div className="w-px h-4 bg-gray-700 mx-1" />

        <button
          onClick={onGenerateAnimatic}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-imagginary-600 hover:bg-imagginary-500 text-black font-semibold transition-colors disabled:opacity-40"
          title="Generate Animatic (Phase 2)"
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Video className="w-3.5 h-3.5" />
          )}
          Animatic
        </button>
      </div>
    </div>
  );
}
