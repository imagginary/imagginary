import React, { useState } from 'react';
import { X, Lock, CheckCircle, ExternalLink } from 'lucide-react';
import { settingsService } from '../services/SettingsService';
import { AppSettings } from '../types';

interface Props {
  isPro: boolean;
  onClose: () => void;
}

type Provider = AppSettings['turntable3dProvider'];

const PROVIDER_OPTIONS: { value: Provider; label: string; cost: string }[] = [
  { value: 'instantmesh', label: 'InstantMesh',   cost: 'Free — local' },
  { value: 'meshy',       label: 'Meshy',         cost: '$0.15 / gen' },
  { value: 'tripo',       label: 'Tripo',         cost: '$0.15 / gen' },
  { value: '3daistudio',  label: '3D AI Studio',  cost: '$0.10–0.20 / gen' },
];

const PROVIDER_PLACEHOLDER: Record<Provider, string> = {
  instantmesh: '',
  meshy:       'msy_xxxxxxxx',
  tripo:       'xxxxxxxx',
  '3daistudio': 'xxxxxxxx',
};

const PROVIDER_LINK: Record<Provider, string> = {
  instantmesh: '',
  meshy:       'https://meshy.ai',
  tripo:       'https://tripo3d.ai',
  '3daistudio': 'https://3daistudio.com',
};

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
    (window as any).electronAPI?.openExternal(link);
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

export default function SettingsModal({ isPro, onClose }: Props) {
  const settings = settingsService.get();
  const [provider, setProvider] = useState<Provider>(settings.turntable3dProvider);
  const [cloudEnabled, setCloudEnabled] = useState(settings.cloudGenerationEnabled);
  const [muapiKey, setMuapiKey] = useState(settings.muapiApiKey);
  const [muapiEndpoint, setMuapiEndpoint] = useState(
    settings.muapiEndpoint || 'https://api.muapi.io/v1/comfyui'
  );
  const [muapiSaved, setMuapiSaved] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl);
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(settings.supabaseAnonKey);
  const [supabaseSaved, setSupabaseSaved] = useState(false);
  const [providerKey, setProviderKey] = useState(() => {
    const s = settingsService.get();
    return { meshy: s.meshyApiKey, tripo: s.tripoApiKey, '3daistudio': s.threeDaiApiKey };
  });
  const [providerKeySaved, setProviderKeySaved] = useState(false);

  function handleCloudToggle(enabled: boolean) {
    setCloudEnabled(enabled);
    settingsService.save({ cloudGenerationEnabled: enabled });
  }

  function handleMuapiSave() {
    settingsService.save({
      muapiApiKey: muapiKey.trim(),
      muapiEndpoint: muapiEndpoint.trim() || 'https://api.muapi.io/v1/comfyui',
      cloudGenerationEnabled: cloudEnabled,
    });
    setMuapiSaved(true);
    setTimeout(() => setMuapiSaved(false), 2000);
  }

  function handleSupabaseSave() {
    settingsService.save({
      supabaseUrl: supabaseUrl.trim(),
      supabaseAnonKey: supabaseAnonKey.trim(),
    });
    setSupabaseSaved(true);
    setTimeout(() => setSupabaseSaved(false), 2000);
  }

  function handleProviderChange(p: Provider) {
    setProvider(p);
    settingsService.save({ turntable3dProvider: p });
    setProviderKeySaved(false);
  }

  function handleProviderKeySave() {
    const keyField: Record<string, keyof AppSettings> = {
      meshy: 'meshyApiKey', tripo: 'tripoApiKey', '3daistudio': 'threeDaiApiKey',
    };
    if (provider !== 'instantmesh') {
      settingsService.save({ [keyField[provider]]: providerKey[provider as keyof typeof providerKey] } as Partial<AppSettings>);
    }
    setProviderKeySaved(true);
    setTimeout(() => setProviderKeySaved(false), 2000);
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

          {/* ── Section 1: Lip Sync ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Lip Sync — Sync.so</p>
              <ProBadge />
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Animate your storyboard panels with AI lip sync. Get a free API key at sync.so.
            </p>
            {isPro ? (
              <KeyInput
                label="API Key"
                keyName="syncsoApiKey"
                placeholder="sk-sync-xxxxxxxx"
                link="https://sync.so"
                linkLabel="Get API key"
              />
            ) : (
              <ProGate />
            )}
          </div>

          <div className="border-t border-gray-800" />

          {/* ── Section 2: 3D Turntable ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">3D Character Turntable</p>
              <ProBadge />
            </div>
            {isPro ? (
              <>
                {/* Provider dropdown */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Provider</label>
                  <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value as Provider)}
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 outline-none transition-colors"
                  >
                    {PROVIDER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label} — {o.cost}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    {provider === 'instantmesh'
                      ? '6-angle multiview — requires InstantMesh running locally'
                      : '3D mesh + thumbnail — best angle selected automatically per shot'}
                  </p>
                </div>

                {/* API key — only for paid providers */}
                {provider !== 'instantmesh' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-400">{PROVIDER_OPTIONS.find(o => o.value === provider)?.label} API Key</label>
                      {PROVIDER_LINK[provider] && (
                        <button
                          onClick={() => (window as any).electronAPI?.openExternal(PROVIDER_LINK[provider])}
                          className="flex items-center gap-1 text-[10px] text-imagginary-500 hover:text-imagginary-400 transition-colors"
                        >
                          Get API key <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={providerKey[provider as keyof typeof providerKey] ?? ''}
                        onChange={(e) => {
                          setProviderKey((prev) => ({ ...prev, [provider]: e.target.value }));
                          setProviderKeySaved(false);
                        }}
                        placeholder={PROVIDER_PLACEHOLDER[provider]}
                        className="flex-1 bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                      />
                      <button
                        onClick={handleProviderKeySave}
                        className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors whitespace-nowrap"
                      >
                        {providerKeySaved ? 'Saved ✓' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <ProGate />
            )}
          </div>

          <div className="border-t border-gray-800" />

          {/* ── Section 3: Character Consistency / Fal.ai ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Character Consistency — Fal.ai</p>
              <ProBadge />
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              When IPAdapter is not installed locally, Fal.ai runs it in the cloud to lock character
              appearance across panels. ~$0.02 per panel.
            </p>
            {isPro ? (
              <>
                <KeyInput
                  label="API Key"
                  keyName="falApiKey"
                  placeholder="key-xxxxxxxx"
                  link="https://fal.ai"
                  linkLabel="Get API key"
                />
                <p className="text-[10px] text-gray-700">
                  If IPAdapter is installed locally in ComfyUI, it will be used automatically — no API key needed.
                </p>
              </>
            ) : (
              <ProGate />
            )}
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
            {isPro ? (
              <>
                {/* Project URL */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">Project URL</label>
                    <button
                      onClick={() => (window as any).electronAPI?.openExternal('https://supabase.com')}
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
              </>
            ) : (
              <div className="flex items-center gap-2 py-3">
                <Lock className="w-4 h-4 text-gray-600" />
                <p className="text-xs text-gray-600">Upgrade to Studio to use Shared Studio collaboration.</p>
              </div>
            )}
          </div>

          <div className="border-t border-gray-800" />

          {/* ── Section 4: Cloud Generation — Muapi ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Cloud Generation — Muapi</p>
              <ProBadge />
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Generate panels in the cloud without a local GPU. Get an API key at muapi.io.
            </p>
            {isPro ? (
              <>
                {/* Enable toggle */}
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={cloudEnabled}
                      onChange={(e) => handleCloudToggle(e.target.checked)}
                    />
                    <div className={`w-9 h-5 rounded-full transition-colors ${cloudEnabled ? 'bg-imagginary-600' : 'bg-gray-700'}`} />
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${cloudEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-xs text-gray-300">Enable cloud generation</span>
                </label>

                {cloudEnabled && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded bg-amber-950/40 border border-amber-800/40">
                    <span className="text-amber-400 text-[10px] leading-relaxed">
                      ⚠ Cloud generation will use your Muapi credits. ~$0.05–0.20 per panel.
                    </span>
                  </div>
                )}

                {/* API key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">API Key</label>
                    <button
                      onClick={() => (window as any).electronAPI?.openExternal('https://muapi.io')}
                      className="flex items-center gap-1 text-[10px] text-imagginary-500 hover:text-imagginary-400 transition-colors"
                    >
                      Get API key <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <input
                    type="password"
                    value={muapiKey}
                    onChange={(e) => { setMuapiKey(e.target.value); setMuapiSaved(false); }}
                    placeholder="mua_xxxxxxxxxxxxxxxx"
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                  />
                </div>

                {/* Endpoint URL */}
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Endpoint URL</label>
                  <input
                    type="text"
                    value={muapiEndpoint}
                    onChange={(e) => { setMuapiEndpoint(e.target.value); setMuapiSaved(false); }}
                    placeholder="https://api.muapi.io/v1/comfyui"
                    className="w-full bg-gray-900 border border-gray-700 focus:border-imagginary-500 rounded px-3 py-2 text-xs text-gray-100 placeholder-gray-600 outline-none font-mono transition-colors"
                  />
                </div>

                <button
                  onClick={handleMuapiSave}
                  className="px-3 py-2 rounded text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-colors"
                >
                  {muapiSaved ? 'Saved ✓' : 'Save'}
                </button>
              </>
            ) : (
              <ProGate />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
