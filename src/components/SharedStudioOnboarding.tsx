import React, { useState } from 'react';
import { X } from 'lucide-react';
import { settingsService } from '../services/SettingsService';

interface Props {
  onClose: () => void;
  onConfigured: () => void;
}

export default function SharedStudioOnboarding({ onClose, onConfigured }: Props) {
  const [url, setUrl] = useState(settingsService.getKey('supabaseUrl'));
  const [anonKey, setAnonKey] = useState(settingsService.getKey('supabaseAnonKey'));
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const trimmedUrl = url.trim();
    const trimmedKey = anonKey.trim();
    if (!trimmedUrl || !trimmedKey) return;
    settingsService.save({ supabaseUrl: trimmedUrl, supabaseAnonKey: trimmedKey });
    setSaved(true);
    setTimeout(() => {
      onConfigured();
    }, 600);
  }

  function openSupabase() {
    window.electronAPI?.openExternal?.('https://supabase.com');
  }

  const ready = url.trim() && anonKey.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
          <span className="text-sm font-semibold text-gray-100">Set up Shared Studio</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Shared Studio uses Supabase for real-time collaboration — it's free and takes about 2 minutes to set up.
          </p>

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

          <ol className="space-y-3">
            <li className="flex gap-3 text-[11px] text-gray-300">
              <span className="text-violet-400 font-bold shrink-0">1.</span>
              <span>
                Go to{' '}
                <button onClick={openSupabase} className="text-violet-400 underline hover:text-violet-300">
                  supabase.com
                </button>{' '}
                and create a free project (takes ~2 min).
              </span>
            </li>
            <li className="flex gap-3 text-[11px] text-gray-300">
              <span className="text-violet-400 font-bold shrink-0">2.</span>
              <span>In your Supabase project → <strong className="text-gray-200">Settings → API</strong> → copy the <strong className="text-gray-200">Project URL</strong> and <strong className="text-gray-200">anon public key</strong>.</span>
            </li>
            <li className="flex gap-3 text-[11px] text-gray-300">
              <span className="text-violet-400 font-bold shrink-0">3.</span>
              <span>Paste them below and click Save.</span>
            </li>
          </ol>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Project URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                className="w-full bg-gray-900 border border-gray-700 focus:border-violet-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Anon Key</label>
              <input
                type="password"
                value={anonKey}
                onChange={(e) => { setAnonKey(e.target.value); setSaved(false); }}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full bg-gray-900 border border-gray-700 focus:border-violet-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!ready}
            className="w-full py-2 rounded text-sm font-semibold bg-violet-700 hover:bg-violet-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saved ? 'Saved — starting session…' : 'Save & Start Collaborating'}
          </button>

          <button onClick={onClose} className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors text-center">
            Set up later
          </button>
        </div>
      </div>
    </div>
  );
}
