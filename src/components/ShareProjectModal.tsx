import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { settingsService } from '../services/SettingsService';

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function ShareProjectModal({ projectId, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const supabaseUrl = settingsService.get().supabaseUrl || '';
  const inviteLink = `imagginary://join?project=${encodeURIComponent(projectId)}&supabase=${encodeURIComponent(supabaseUrl)}`;

  function handleCopy() {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
          <span className="text-sm font-semibold text-gray-100">Share Project</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Share this link with your team. They need Imagginary Studio installed to join.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Invite link</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-300 outline-none font-mono select-all"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-semibold bg-imagginary-700 hover:bg-imagginary-600 text-white transition-colors whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="px-3 py-2.5 rounded bg-gray-900 border border-gray-800 space-y-1">
            <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">How to join</p>
            <ol className="text-[11px] text-gray-500 leading-relaxed list-decimal list-inside space-y-0.5">
              <li>Share the invite link above</li>
              <li>Teammate opens Imagginary Studio</li>
              <li>Teammate clicks the link — project loads automatically</li>
              <li>Changes sync in real time</li>
            </ol>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mt-3">
            <p className="text-amber-400 text-xs font-medium mb-1">
              Treat this link like a shared document link
            </p>
            <p className="text-amber-400/80 text-xs">
              Anyone with this link can join and edit this project. Don't post it publicly —
              share it directly with people you trust. If a link is ever leaked, you can revoke
              access instantly in Settings → Shared Studio.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
