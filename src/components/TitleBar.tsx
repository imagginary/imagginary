import React, { useState, useRef } from 'react';
import { Save, FolderOpen, Plus, Video, Loader2, HelpCircle, Settings, ScrollText, FileText, FileCode, Lock, X, Clapperboard, Star, Zap, Users, Link } from 'lucide-react';
import { ServiceStatus } from '../types';
import type { Tier } from '../utils/tierColors';

interface TitleBarProps {
  projectTitle: string;
  serviceStatus: ServiceStatus;
  onNewProject: () => void;
  onRenameProject?: (title: string) => void;
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
  isPro?: boolean;
  isStudio?: boolean;
  currentTier?: Tier;
  tierAccent?: string;
  onActivateLicense?: () => void;
  onUpgradeToStudio?: () => void;
  isSharedSession?: boolean;
  onStartSharedSession?: () => void;
  onCopyInviteLink?: () => void;
  sharedStudioConfigured?: boolean;
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

function StudioUpgradeModal({ onClose, onUpgrade }: { onClose: () => void; onUpgrade?: () => void }) {
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
          Pro feature — upgrade to Pro or Studio to export PDF and XML. Export your boards straight into your edit.
        </p>
        <button
          onClick={onUpgrade}
          className="w-full px-4 py-2 bg-imagginary-500 hover:bg-imagginary-400 text-black text-sm font-semibold rounded-lg transition-colors mb-3"
        >
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
  onRenameProject,
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
  isPro = false,
  isStudio = false,
  currentTier = 'community' as Tier,
  tierAccent = '#ceaf82',
  onActivateLicense,
  onUpgradeToStudio,
  isExportingMotionComic,
  motionComicProgress,
  hasMotionClips,
  isSharedSession = false,
  onStartSharedSession,
  onCopyInviteLink,
  sharedStudioConfigured = false,
}: TitleBarProps) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  function startTitleEdit() {
    if (!onRenameProject) return;
    setTitleDraft(projectTitle);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }

  function commitTitleEdit() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim() || 'Untitled Project';
    if (trimmed !== projectTitle) onRenameProject?.(trimmed);
  }

  function handleExportPDF() {
    if (!isPro && !isStudio) { onActivateLicense ? onActivateLicense() : setShowUpgrade(true); return; }
    onExportPDF();
  }

  function handleExportXML() {
    if (!isPro && !isStudio) { onActivateLicense ? onActivateLicense() : setShowUpgrade(true); return; }
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
          {/* 32px mark — simplified for small sizes per brand guidelines */}
          <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="14" y="14" width="28" height="22" rx="2" fill="none" stroke={tierAccent} strokeWidth="2" opacity="0.4"/>
            <rect x="6" y="6" width="28" height="22" rx="2" fill="#080808" stroke={tierAccent} strokeWidth="2.5"/>
            <rect x="3" y="10" width="4" height="3" rx="0.75" fill={tierAccent} opacity="0.7"/>
            <rect x="3" y="16" width="4" height="3" rx="0.75" fill={tierAccent} opacity="0.7"/>
            <rect x="33" y="10" width="4" height="3" rx="0.75" fill={tierAccent} opacity="0.7"/>
            <rect x="33" y="16" width="4" height="3" rx="0.75" fill={tierAccent} opacity="0.7"/>
          </svg>
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: tierAccent }}>Imagginary</span>
          {currentTier !== 'community' && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1"
              style={{
                backgroundColor: `${tierAccent}20`,
                color: tierAccent,
                border: `1px solid ${tierAccent}40`,
              }}
            >
              {currentTier.toUpperCase()}
            </span>
          )}
          <span className="text-gray-600 text-xs">|</span>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitleEdit();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="text-sm text-gray-200 font-medium bg-gray-800 border border-imagginary-500/50 rounded px-1.5 py-0.5 outline-none max-w-[240px] min-w-[120px]"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            />
          ) : (
            <span
              className={`text-sm text-gray-200 font-medium truncate max-w-[240px] ${onRenameProject ? 'cursor-pointer hover:text-white' : ''}`}
              onClick={startTitleEdit}
              title={onRenameProject ? 'Click to rename project' : undefined}
            >
              {projectTitle}
            </span>
          )}
        </div>

        {/* Center — empty, service status removed */}
        <div />

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
            <div className="flex items-center gap-0.5">
              <button
                onClick={onStartSharedSession}
                className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                  isSharedSession
                    ? 'text-green-400 hover:text-green-300 hover:bg-green-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
                title={isSharedSession ? 'Leave shared session' : 'Start collaboration session'}
              >
                <Users className="w-3.5 h-3.5" />
                {isSharedSession ? 'Live' : 'Collab'}
                {isSharedSession && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
              {sharedStudioConfigured && (
                <button
                  onClick={onCopyInviteLink}
                  className="p-1.5 rounded text-gray-500 hover:text-violet-400 hover:bg-gray-800 transition-colors"
                  title="Anyone with this link can join. Treat it like a private document link — see Settings to revoke access if needed."
                >
                  <Link className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          <div className="w-px h-4 bg-gray-700 mx-1" />

          {/* License / tier indicator */}
          {isStudio ? (
            <button
              onClick={onActivateLicense}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase transition-colors"
              style={{ color: tierAccent }}
              title="Studio — manage license"
            >
              <Star className="w-3 h-3" /> Studio
            </button>
          ) : isPro ? (
            <button
              onClick={onActivateLicense}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase transition-colors"
              style={{ color: tierAccent }}
              title="Pro active — click to manage or upgrade to Studio"
            >
              <Zap className="w-3 h-3" /> Pro
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
            title={(isPro || isStudio) ? 'Export PDF storyboard' : 'Export PDF — Pro feature'}
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
            {!isPro && !isStudio && <Lock className="w-2.5 h-2.5 text-imagginary-500/60" />}
          </button>

          <button
            onClick={handleExportXML}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title={(isPro || isStudio) ? 'Export Premiere Pro XML' : 'Export XML — Pro feature'}
          >
            <FileCode className="w-3.5 h-3.5" />
            XML
            {!isPro && !isStudio && <Lock className="w-2.5 h-2.5 text-imagginary-500/60" />}
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
                  ? `${exportProgress.toFixed(1)}%`
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
                {motionComicProgress > 0 ? `${motionComicProgress.toFixed(1)}%` : 'Exporting…'}
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

      {showUpgrade && <StudioUpgradeModal onClose={() => setShowUpgrade(false)} onUpgrade={onUpgradeToStudio} />}
    </>
  );
}
