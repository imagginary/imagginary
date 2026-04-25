import React, { useState, useEffect, useRef } from 'react';
import { Film, RefreshCw, ChevronRight, ChevronLeft, Clapperboard } from 'lucide-react';
import { ServiceStatus, StyleProfile } from '../types';
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
  onRefreshServices: () => void;
  onComplete: (params: WelcomeCompleteParams) => void;
}

function ServiceRow({ label, status, fix }: { label: string; status: string; fix?: string }) {
  const isOk = status === 'connected';
  const isChecking = status === 'checking';
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          isOk ? 'bg-green-400' : isChecking ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'
        }`} />
        <span className="text-sm text-gray-200 w-28">{label}</span>
        <span className={`text-sm ${isOk ? 'text-green-400' : isChecking ? 'text-yellow-400' : 'text-red-400'}`}>
          {isOk ? 'Running — ready' : isChecking ? 'Checking…' : 'Not running'}
        </span>
      </div>
      {!isOk && !isChecking && fix && (
        <div className="ml-[26px] text-xs text-gray-500 font-mono bg-gray-900 rounded px-2 py-1 mt-0.5">
          {fix}
        </div>
      )}
    </div>
  );
}

export default function WelcomeFlow({ serviceStatus, servicesAutoStarted = false, onRefreshServices, onComplete }: Props) {
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
    localStorage.setItem('imagginary_onboarded', '1');
    onComplete({
      title: projectTitle.trim() || 'Untitled Project',
      style: STYLE_BY_PROJECT_TYPE[projectType],
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
            {[1, 2, 3].map((s) => (
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
                    ? 'Services are starting up — ComfyUI may take 1–2 minutes to load. Click Check again shortly.'
                    : 'Imagginary needs two services running on your machine.'}
                </p>
              </div>
              <div className="flex flex-col gap-3 bg-gray-950 rounded-lg px-4 py-4 border border-gray-800">
                <ServiceRow
                  label="Ollama"
                  status={serviceStatus.ollama}
                  fix="Open Terminal and run: ollama serve"
                />
                <div>
                  <ServiceRow
                    label="ComfyUI"
                    status={serviceStatus.comfyui}
                    fix="In your ComfyUI folder run: ./start.sh  (or python main.py)"
                  />
                  {servicesAutoStarted && serviceStatus.comfyui !== 'connected' && (
                    <p className="ml-[26px] text-xs text-imagginary-500/80 animate-pulse mt-0.5">
                      Starting — may take 1–2 min…
                    </p>
                  )}
                </div>
                <div className="border-t border-gray-800 pt-3 mt-1">
                  <ServiceRow
                    label="InstantMesh"
                    status={serviceStatus.instantmesh}
                  />
                  <p className="ml-[26px] text-xs text-gray-600 mt-0.5">Optional — for multi-angle character consistency</p>
                </div>
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

        </div>
      </div>
    </div>
  );
}
