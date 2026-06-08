import React, { useState, useEffect, useRef } from 'react';
import { Film, RefreshCw, ChevronRight, ChevronLeft, Clapperboard } from 'lucide-react';
import { ServiceStatus, StyleProfile } from '../types';
import { telemetryService } from '../services/TelemetryService';
import {
  STYLE_CLASSIC_STORYBOARD,
  STYLE_ANIMATION_KEYFRAME,
  STYLE_GRAPHIC_NOVEL,
  STYLE_GAME_PREVIS,
} from '../data/StyleVault';

type ProjectType = 'film' | 'animation' | 'graphic-novel' | 'game';

const PROJECT_TYPES: { type: ProjectType; emoji: string; label: string; subtitle: string }[] = [
  { type: 'film',          emoji: '🎬', label: 'Film / Short',    subtitle: 'Feature, short film, or music video' },
  { type: 'animation',     emoji: '✏️',  label: 'Animation',       subtitle: '2D, 3D, or motion comic' },
  { type: 'graphic-novel', emoji: '📖', label: 'Graphic Novel',   subtitle: 'Comics, manga, or illustrated story' },
  { type: 'game',          emoji: '🎮', label: 'Game / Previs',   subtitle: 'Cutscene, cinematic, or pitch' },
];

// StyleVault is the single source of truth — no inline style data here.
const STYLE_BY_PROJECT_TYPE: Record<ProjectType, StyleProfile> = {
  'film':          STYLE_CLASSIC_STORYBOARD,
  'animation':     STYLE_ANIMATION_KEYFRAME,
  'graphic-novel': STYLE_GRAPHIC_NOVEL,
  'game':          STYLE_GAME_PREVIS,
};

const EXAMPLE_SHOTS: Record<ProjectType, string> = {
  'film':          'A detective sits at a rain-soaked desk, cigarette smoke curling under a single lamp. Film noir. Low angle.',
  'animation':     'A young wizard raises her staff, wind whipping her cloak. Dramatic low angle. Magic hour lighting.',
  'graphic-novel': 'Extreme close-up on weathered eyes scanning a crowded marketplace. Ink sketch. High contrast shadows.',
  'game':          'A soldier emerges from fog into a ruined city. Wide establishing shot. Overcast light. Cinematic.',
};

export interface WelcomeCompleteParams {
  title: string;
  style: StyleProfile;
  firstShot: string;
}

interface Props {
  serviceStatus: ServiceStatus;
  servicesAutoStarted?: boolean;
  comfyuiInstallMessage?: string;
  onRefreshServices: () => void;
  onComplete: (params: WelcomeCompleteParams) => void;
}

function ServiceRow({ label, status, statusText }: { label: string; status: string; statusText?: string }) {
  const isOk = status === 'connected';
  const isChecking = status === 'checking';
  const isInstalling = !!statusText && !isOk && !isChecking;
  const dotColor = isOk ? 'bg-green-400' : isChecking ? 'bg-yellow-400 animate-pulse' : isInstalling ? 'bg-yellow-400 animate-pulse' : 'bg-red-500';
  const textColor = isOk ? 'text-green-400' : (isChecking || isInstalling) ? 'text-yellow-400' : 'text-red-400';
  const displayText = statusText ?? (isOk ? 'Running — ready' : isChecking ? 'Checking…' : 'Not running');
  return (
    <div className="flex items-center gap-3">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
      <span className="text-sm text-gray-200 w-28">{label}</span>
      <span className={`text-sm ${textColor}`}>{displayText}</span>
    </div>
  );
}

export default function WelcomeFlow({ serviceStatus, servicesAutoStarted = false, comfyuiInstallMessage = '', onRefreshServices, onComplete }: Props) {
  // Skip step 1 (service setup) entirely when the main process auto-started services.
  const [step, setStep] = useState(servicesAutoStarted ? 2 : 1);
  const [projectType, setProjectType] = useState<ProjectType | null>(null);
  const [projectTitle, setProjectTitle] = useState('Untitled Project');
  const [shotDescription, setShotDescription] = useState('');
  const [visible, setVisible] = useState(false);
  const autoAdvancedRef = useRef(false);

  // Fade in on mount
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  // Auto-advance from step 1 to step 2 if both services become green
  // (covers manual-start and the case where autoStarted races with service polling)
  useEffect(() => {
    if (step !== 1 || autoAdvancedRef.current) return;
    if (serviceStatus.ollama === 'connected' && serviceStatus.comfyui === 'connected') {
      autoAdvancedRef.current = true;
      setTimeout(() => setStep(2), 800);
    }
  }, [serviceStatus, step]);

  // Auto-poll every 10 s in packaged mode while services are still starting up
  useEffect(() => {
    if (!servicesAutoStarted) return;
    if (serviceStatus.ollama === 'connected' && serviceStatus.comfyui === 'connected') return;
    const interval = setInterval(() => { onRefreshServices(); }, 10000);
    return () => clearInterval(interval);
  }, [servicesAutoStarted, serviceStatus.ollama, serviceStatus.comfyui]);

  const bothReady = serviceStatus.ollama === 'connected' && serviceStatus.comfyui === 'connected';

  function handleComplete() {
    if (!projectType || !shotDescription.trim()) return;
    if (!telemetryService.hasAnswered()) {
      // Show consent step before finishing
      setStep(4);
      return;
    }
    localStorage.setItem('imagginary_onboarded', '1');
    onComplete({
      title: projectTitle.trim() || 'Untitled Project',
      style: STYLE_BY_PROJECT_TYPE[projectType],
      firstShot: shotDescription.trim(),
    });
  }

  function handleConsentAndComplete(grant: boolean) {
    if (grant) telemetryService.grant();
    else telemetryService.deny();
    localStorage.setItem('imagginary_onboarded', '1');
    onComplete({
      title: projectTitle.trim() || 'Untitled Project',
      style: STYLE_BY_PROJECT_TYPE[projectType!],
      firstShot: shotDescription.trim(),
    });
  }

  // When project type selected, pre-fill the example shot if field is blank
  function selectProjectType(t: ProjectType) {
    setProjectType(t);
    if (!shotDescription) setShotDescription(EXAMPLE_SHOTS[t]);
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Card */}
      <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex flex-col items-center pt-8 pb-5 px-8 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-1">
            <Film className="w-5 h-5 text-imagginary-400" />
            <span className="text-imagginary-400 text-sm font-semibold tracking-widest uppercase">Imagginary</span>
          </div>
          <p className="text-gray-500 text-xs">AI Storyboard Generator</p>
          {/* Step dots */}
          <div className="flex items-center gap-2 mt-5">
            {[1, 2, 3, 4].map((s) => (
              <span
                key={s}
                className={`rounded-full transition-all duration-300 ${
                  s === step ? 'w-5 h-2 bg-imagginary-400' : s < step ? 'w-2 h-2 bg-imagginary-600' : 'w-2 h-2 bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-6 min-h-[300px] flex flex-col">

          {/* ── Step 1 ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Getting ready</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {servicesAutoStarted
                    ? 'Setting up your local AI… this only happens once.'
                    : 'Imagginary needs two services running on your machine.'}
                </p>
              </div>

              {servicesAutoStarted ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-4 py-4">
                  <div className="w-8 h-8 rounded-full border-2 border-imagginary-500 border-t-transparent animate-spin" />
                  <div className="flex flex-col gap-2 w-full">
                    <ServiceRow label="Ollama" status={serviceStatus.ollama} />
                    <ServiceRow
                      label="ComfyUI"
                      status={serviceStatus.comfyui}
                      statusText={
                        serviceStatus.comfyui !== 'connected' && comfyuiInstallMessage
                          ? comfyuiInstallMessage
                          : serviceStatus.comfyui !== 'connected'
                          ? 'Setting up ComfyUI…'
                          : undefined
                      }
                    />
                  </div>
                  <p className="text-xs text-gray-600 text-center">
                    Setting up your AI engine — this only happens once. Checking automatically…
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-3 bg-gray-950 rounded-lg px-4 py-4 border border-gray-800">
                    <ServiceRow label="Ollama" status={serviceStatus.ollama} />
                    <ServiceRow label="ComfyUI" status={serviceStatus.comfyui} />
                  </div>
                  <div className="flex items-center gap-3 mt-auto">
                    <button
                      onClick={onRefreshServices}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Check again
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      disabled={!bothReady}
                      className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Continue
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">What are you making?</h2>
                <p className="text-sm text-gray-500 mt-0.5">This sets the visual style for your storyboard.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PROJECT_TYPES.map(({ type, emoji, label, subtitle }) => (
                  <button
                    key={type}
                    onClick={() => selectProjectType(type)}
                    className={`flex flex-col items-start gap-0.5 px-3 py-3 rounded-lg border text-left transition-all ${
                      projectType === type
                        ? 'border-imagginary-500 bg-imagginary-500/10 text-gray-100'
                        : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600 hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-xl leading-none mb-1">{emoji}</span>
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xs text-gray-500">{subtitle}</span>
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Project name</label>
                <input
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="Untitled Project"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-imagginary-500 transition-colors"
                />
              </div>
              <div className="flex items-center gap-3 mt-auto">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!projectType}
                  className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Your first panel</h2>
                <p className="text-sm text-gray-500 mt-0.5">Describe a shot. Be specific — angle, mood, lighting all help.</p>
              </div>
              <textarea
                value={shotDescription}
                onChange={(e) => setShotDescription(e.target.value)}
                placeholder={projectType ? EXAMPLE_SHOTS[projectType] : 'Describe your shot…'}
                rows={5}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-3 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-imagginary-500 transition-colors resize-none"
              />
              <div className="flex items-center gap-3 mt-auto">
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={!shotDescription.trim()}
                  className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Clapperboard className="w-4 h-4" />
                  Generate My First Panel
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4 — Telemetry consent ── */}
          {step === 4 && (
            <div className="flex flex-col gap-5 flex-1">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">Help us improve Imagginary</h2>
                <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                  We'd like to collect anonymous usage data — which features you use, how often you generate panels.
                  No prompts, no images, no personal data. Ever.
                </p>
              </div>
              <div className="flex flex-col gap-2 mt-auto">
                <button
                  onClick={() => handleConsentAndComplete(true)}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-imagginary-500 hover:bg-imagginary-400 text-black transition-colors"
                >
                  Yes, share anonymously
                </button>
                <button
                  onClick={() => handleConsentAndComplete(false)}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  No thanks
                </button>
                <p className="text-xs text-gray-600 text-center mt-1">
                  You can change this anytime in settings. We use Umami — open source, GDPR compliant.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
