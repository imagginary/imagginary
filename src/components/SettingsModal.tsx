import React, { useState, useEffect } from 'react';
import { X, Lock, CheckCircle, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { settingsService } from '../services/SettingsService';
import { comfyUIService } from '../services/ComfyUIService';
import { AppSettings } from '../types';
import CreditUsageBar from './CreditUsageBar';

interface Props {
  isPro: boolean;
  isStudio?: boolean;
  onClose: () => void;
}


function ProBadge() {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-imagginary-900/40 text-imagginary-400 border border-imagginary-800/40 font-medium uppercase tracking-wide">
      Pro
    </span>
  );
}

function ProGate() {
  return (
    <div className="flex items-center gap-2 py-3">
      <Lock className="w-4 h-4 text-gray-600" />
      <p className="text-xs text-gray-600">Upgrade to Pro to configure cloud integrations.</p>
    </div>
  );
}

function KeyInput({
  label, keyName, placeholder, link, linkLabel,
}: {
  label: string;
  keyName: keyof AppSettings;
  placeholder: string;
  link: string;
  linkLabel?: string;
}) {
  const [value, setValue] = useState(settingsService.getKey(keyName));
  const [saved, setSaved] = useState(false);
  const hasKey = !!value.trim();

  function handleSave() {
    settingsService.save({ [keyName]: value.trim() } as Partial<AppSettings>);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function openLink() {
    window.electronAPI?.openExternal(link);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-400">{label}</label>
        <div className="flex items-center gap-2">
          {hasKey && (
            <span className="flex items-center gap-1 text-[10px] text-green-500">
              <CheckCircle className="w-3 h-3" /> Connected
            </span>
          )}
          {link && (
            <button
              onClick={openLink}
              className="flex items-center gap-1 text-[10px] text-imagginary-500 hover:text-imagginary-400 transition-colors"
            >
              Get API key <ExternalLink className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder={placeholder}
          className="flex-1 bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
        />
        <button
          onClick={handleSave}
          className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors whitespace-nowrap"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function SettingsModal({ isPro, isStudio = false, onClose }: Props) {
  const settings = settingsService.get();
  const [availableCheckpoints, setAvailableCheckpoints] = useState<string[]>([]);
  const [activeCheckpoint, setActiveCheckpoint] = useState(settings.activeCheckpoint ?? '');
  const [checkpointSaved, setCheckpointSaved] = useState(false);
  const [proModelDownloading, setProModelDownloading] = useState(false);
  const [proModelPct, setProModelPct] = useState(0);
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl);
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(settings.supabaseAnonKey);
  const [supabaseSaved, setSupabaseSaved] = useState(false);
  const [absDownloading, setAbsDownloading] = useState(false);
  const [absPct, setAbsPct] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [serviceUrls, setServiceUrls] = useState({
    ollamaUrl:  settings.ollamaUrl  || '',
    comfyuiUrl: settings.comfyuiUrl || '',
  });
  const [serviceUrlsSaved, setServiceUrlsSaved] = useState(false);
  const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel || '');
  const [ollamaModelSaved, setOllamaModelSaved] = useState(false);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsSaved, setElevenLabsSaved] = useState(false);
  useEffect(() => {
    comfyUIService.getAvailableCheckpoints().then(setAvailableCheckpoints).catch(() => {});
  }, []);

  function handleCheckpointSave() {
    settingsService.save({ activeCheckpoint: activeCheckpoint.trim() });
    setCheckpointSaved(true);
    setTimeout(() => setCheckpointSaved(false), 2000);
  }

  async function handleDownloadProModel() {
    const api = window.electronAPI;
    if (!api) return;
    setProModelDownloading(true);
    setProModelPct(0);
    const cleanup = api.onProModelProgress((data: { pct: number }) => {
      setProModelPct(data.pct);
    });
    await api.downloadProModel();
    cleanup();
    setProModelDownloading(false);
    // Refresh checkpoint list so the new model appears in the dropdown
    comfyUIService.getAvailableCheckpoints().then(setAvailableCheckpoints).catch(() => {});
  }

  function handleServiceUrlsSave() {
    settingsService.save({
      ollamaUrl:  serviceUrls.ollamaUrl.trim(),
      comfyuiUrl: serviceUrls.comfyuiUrl.trim(),
    });
    setServiceUrlsSaved(true);
    setTimeout(() => setServiceUrlsSaved(false), 2000);
  }

  function handleSupabaseSave() {
    settingsService.save({
      supabaseUrl: supabaseUrl.trim(),
      supabaseAnonKey: supabaseAnonKey.trim(),
    });
    setSupabaseSaved(true);
    setTimeout(() => setSupabaseSaved(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <span className="text-sm font-semibold text-gray-100">Settings</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">

          {/* ── Active Model ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Active Model</p>

            {/* Model cards */}
            {(() => {
              const dreamshaperInstalled   = availableCheckpoints.some((c) => /dreamshaper/i.test(c));
              const absoluteRealityInstalled = availableCheckpoints.some((c) => /absolutereality/i.test(c));
              const realvisxlInstalled     = availableCheckpoints.some((c) => /realvisxl/i.test(c));
              return (
                <div className="space-y-2">
                  {/* Community default — DreamShaper 8 */}
                  <div className="border border-gray-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-200">DreamShaper 8</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">2GB · Artistic storyboard style</p>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 shrink-0">COMMUNITY</span>
                    </div>
                    {dreamshaperInstalled ? (
                      <p className="text-[11px] text-emerald-400">✓ Already installed</p>
                    ) : (
                      <p className="text-[11px] text-gray-500">Not installed — use the setup banner to download.</p>
                    )}
                  </div>

                  {/* Pro — AbsoluteReality */}
                  <div className={`border rounded-lg p-3 space-y-2 ${isPro ? 'border-gray-800' : 'border-gray-800/40 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-200">AbsoluteReality</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">2GB · Photorealistic, all genres</p>
                      </div>
                      <ProBadge />
                    </div>
                    {!isPro ? (
                      <p className="text-[11px] text-amber-500/70">Pro or Studio required</p>
                    ) : absoluteRealityInstalled ? (
                      <p className="text-[11px] text-emerald-400">✓ Already installed</p>
                    ) : absDownloading ? (
                      <div className="space-y-1">
                        <div className="w-full bg-gray-800 rounded-full h-1">
                          <div className="bg-amber-400 h-1 rounded-full transition-all" style={{ width: `${absPct}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-500">{Number(absPct).toFixed(1)}% downloading…</p>
                      </div>
                    ) : (
                      <button
                        onClick={async () => {
                          setAbsDownloading(true);
                          setAbsPct(0);
                          const cleanup = window.electronAPI?.onAbsoluteRealityProgress(
                            (d: { pct: number }) => setAbsPct(d.pct)
                          );
                          const result = await window.electronAPI?.downloadAbsoluteReality();
                          cleanup?.();
                          setAbsDownloading(false);
                          if (result?.success) {
                            comfyUIService.getAvailableCheckpoints().then(setAvailableCheckpoints).catch(() => {});
                          }
                        }}
                        className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1 rounded border border-gray-700"
                      >
                        Download (2GB)
                      </button>
                    )}
                  </div>

                  {/* Pro — RealVisXL V4.0 */}
                  <div className={`border rounded-lg p-3 space-y-2 ${isPro ? 'border-amber-800/40' : 'border-gray-800/40 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-200">
                          RealVisXL V4.0{' '}
                          <span className="text-amber-400 text-[10px]">★ Recommended for Pro</span>
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">6.5GB · Best quality, cinematic realism</p>
                      </div>
                      <ProBadge />
                    </div>
                    {!isPro ? (
                      <p className="text-[11px] text-amber-500/70">Pro or Studio required</p>
                    ) : realvisxlInstalled ? (
                      <p className="text-[11px] text-emerald-400">✓ Already installed</p>
                    ) : proModelDownloading ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                          <div
                            className="bg-amber-400 h-1.5 rounded-full transition-all"
                            style={{ width: `${proModelPct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-amber-400">{Number(proModelPct).toFixed(1)}%</span>
                      </div>
                    ) : (
                      <button
                        onClick={handleDownloadProModel}
                        className="text-[11px] bg-amber-700 hover:bg-amber-600 text-white px-2 py-1 rounded"
                      >
                        Download (6.5GB)
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Active model selector — only installed models */}
            {availableCheckpoints.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Active model</label>
                  <select
                    value={activeCheckpoint}
                    onChange={(e) => { setActiveCheckpoint(e.target.value); setCheckpointSaved(false); }}
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 outline-none transition-colors"
                  >
                    <option value="">Auto (recommended)</option>
                    {availableCheckpoints.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Changing the model changes the visual style of all generated panels.
                </p>
                <button
                  onClick={handleCheckpointSave}
                  className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
                >
                  {checkpointSaved ? 'Saved ✓' : 'Save'}
                </button>
              </>
            ) : (
              <p className="text-[11px] text-gray-500">
                ComfyUI not connected — start ComfyUI to manage models.
              </p>
            )}
          </div>

          <div className="border-t border-gray-800" />

          {/* ── Credits ── */}
          {isPro && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Your Credits</p>
              <CreditUsageBar showCosts={true} />
            </div>
          )}

          <div className="border-t border-gray-800" />

          <div className="border-t border-gray-800" />

          {/* ── Section 2: 3D Turntable ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">3D Character Turntable</p>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700 font-medium uppercase tracking-wide">Coming Soon</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Generate a 360° turntable from any panel image. Configuration options will appear here when this feature launches.
            </p>
          </div>

          <div className="border-t border-gray-800" />

          {/* ── Section 5: Shared Studio — Supabase ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Shared Studio — Supabase</p>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-400 border border-violet-800/40 font-medium uppercase tracking-wide">Studio</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Collaborate in real-time with your team. Create a free Supabase project at supabase.com and paste your credentials below.
            </p>
            {isStudio ? (
              <>
                {/* Project URL */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">Project URL</label>
                    <button
                      onClick={() => window.electronAPI?.openExternal('https://supabase.com')}
                      className="flex items-center gap-1 text-[10px] text-imagginary-500 hover:text-imagginary-400 transition-colors"
                    >
                      Create free project <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={supabaseUrl}
                    onChange={(e) => { setSupabaseUrl(e.target.value); setSupabaseSaved(false); }}
                    placeholder="https://xxxxxxxxxxxx.supabase.co"
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                  />
                </div>

                {/* Anon key */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Anon Key</label>
                  <input
                    type="password"
                    value={supabaseAnonKey}
                    onChange={(e) => { setSupabaseAnonKey(e.target.value); setSupabaseSaved(false); }}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                  />
                </div>

                <p className="text-[10px] text-gray-700 leading-relaxed">
                  After creating your project: Settings → API → copy Project URL and anon public key.
                </p>

                <button
                  onClick={handleSupabaseSave}
                  className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
                >
                  {supabaseSaved ? 'Saved ✓' : 'Save'}
                </button>

                <div className="border-t border-gray-800 pt-4 mt-4">
                  <p className="text-xs font-medium text-gray-300 mb-1">Revoke shared access</p>
                  <p className="text-xs text-gray-500 mb-2">
                    If an invite link was shared somewhere it shouldn't have been, revoke access
                    immediately. This generates a new anon key in your Supabase project and
                    invalidates all existing invite links.
                  </p>
                  <button
                    onClick={() => {
                      const projectSlug = supabaseUrl.trim().match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
                      const target = projectSlug
                        ? `${supabaseUrl.trim()}/project/${projectSlug}/settings/api`
                        : 'https://supabase.com/dashboard';
                      window.electronAPI?.openExternal(target);
                    }}
                    className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-2 rounded-lg border border-red-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Regenerate anon key on Supabase →
                  </button>
                  <p className="text-xs text-gray-600 mt-2">
                    After regenerating, paste the new key above and click Save. Update it on
                    every device you and your collaborators use.
                  </p>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 py-3">
                <Lock className="w-4 h-4 text-gray-600" />
                <p className="text-xs text-gray-600">Upgrade to Studio to use Shared Studio collaboration.</p>
              </div>
            )}
          </div>

          <div className="border-t border-gray-800" />

          {/* ── ElevenLabs BYOK ── */}
          {isStudio && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Voice Cloning — ElevenLabs</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 border border-gray-600 font-medium uppercase tracking-wide">Optional BYOK</span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                By default, voice cloning uses Cartesia Sonic (included in Studio).
                Paste your own ElevenLabs API key to use ElevenLabs instead —
                higher naturalness quality, your ElevenLabs subscription required.{' '}
                <button
                  onClick={() => window.electronAPI?.openExternal('https://elevenlabs.io/api')}
                  className="text-violet-400 hover:text-violet-300 transition-colors"
                >
                  Get API key →
                </button>
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={elevenLabsKey}
                  onChange={e => { setElevenLabsKey(e.target.value); setElevenLabsSaved(false); }}
                  placeholder="sk_... (optional — leave blank to use Cartesia)"
                  className="flex-1 bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                />
                <button
                  onClick={async () => {
                    await window.electronAPI?.saveElevenLabsKey?.({ key: elevenLabsKey.trim() });
                    setElevenLabsSaved(true);
                    setTimeout(() => setElevenLabsSaved(false), 2000);
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
                >
                  {elevenLabsSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
              {elevenLabsKey && (
                <p className="text-[10px] text-green-500">
                  ✓ ElevenLabs key configured — voice cloning will use ElevenLabs
                </p>
              )}
            </div>
          )}

          <div className="border-t border-gray-800" />

          {/* ── Advanced — Service URLs ── */}
          <div className="border-t border-gray-800" />
          <div className="space-y-3">
            <button
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full text-left"
            >
              {advancedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-semibold uppercase tracking-wide">Advanced — Service URLs</span>
            </button>

            {advancedOpen && (
              <div className="space-y-3">
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Only change these if you're running services on custom ports or remote hosts.
                  Leave blank to use the defaults.
                </p>

                {(
                  [
                    { key: 'ollamaUrl',  label: 'Ollama URL',  placeholder: 'http://127.0.0.1:11434' },
                    { key: 'comfyuiUrl', label: 'ComfyUI URL', placeholder: 'http://127.0.0.1:8188'  },
                  ] as const
                ).map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs text-gray-400">{label}</label>
                    <input
                      type="text"
                      value={serviceUrls[key]}
                      onChange={(e) => {
                        setServiceUrls((prev) => ({ ...prev, [key]: e.target.value }));
                        setServiceUrlsSaved(false);
                      }}
                      placeholder={placeholder}
                      className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                    />
                  </div>
                ))}

                <button
                  onClick={handleServiceUrlsSave}
                  className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
                >
                  {serviceUrlsSaved ? 'Saved ✓' : 'Save'}
                </button>

                <div className="border-t border-gray-800/60 pt-3 space-y-2">
                  <label className="text-xs text-gray-400">Ollama Model</label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => { setOllamaModel(e.target.value); setOllamaModelSaved(false); }}
                    placeholder="qwen2.5:3b"
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                  />
                  <p className="text-[11px] text-gray-500">
                    Default: qwen2.5:3b. Change only if you have a different model installed.
                  </p>
                  <button
                    onClick={() => {
                      settingsService.save({ ollamaModel: ollamaModel.trim() });
                      setOllamaModelSaved(true);
                      setTimeout(() => setOllamaModelSaved(false), 2000);
                    }}
                    className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
                  >
                    {ollamaModelSaved ? 'Saved ✓' : 'Save'}
                  </button>
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
