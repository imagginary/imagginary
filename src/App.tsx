import React, { useState, useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import ScriptReader from './components/ScriptReader';
import StylePicker from './components/StylePicker';
import WelcomeFlow, { WelcomeCompleteParams } from './components/WelcomeFlow';
import PanelList from './components/PanelList';
import PanelViewer from './components/PanelViewer';
import PoseEditor from './components/PoseEditor';
import MotionLibrary from './components/MotionLibrary';
import VideoTransfer from './components/VideoTransfer';
import VoiceStudio from './components/VoiceStudio';
import ActivateLicense from './components/ActivateLicense';
import SettingsModal from './components/SettingsModal';
import SharedStudioPanel from './components/SharedStudioPanel';
import ShareProjectModal from './components/ShareProjectModal';
import SharedStudioOnboarding from './components/SharedStudioOnboarding';
import LoRATrainer from './components/LoRATrainer';
import { sharedStudioService, SharedStudioEvent, SharedStudioConnectionStatus } from './services/SharedStudioService';
import ShotInput, { ShotConstraints } from './components/ShotInput';
import CharacterLibrary from './components/CharacterLibrary';
import RightSidebar from './components/RightSidebar';
import { licenseService, CREDIT_COSTS } from './services/LicenseService';
import { getTier, TIER_COLORS } from './utils/tierColors';
import { telemetryService } from './services/TelemetryService';
import { settingsService } from './services/SettingsService';
import { ollamaService } from './services/OllamaService';
import { comfyUIService } from './services/ComfyUIService';
import { characterLibraryService } from './services/CharacterLibraryService';
import { animaticExporter } from './services/AnimaticExporter';
import { productionExporter } from './services/ProductionExporter';
import { motionComicExporter } from './services/MotionComicExporter';
import { customStyleService } from './services/CustomStyleService';
import { poseEngineService } from './services/PoseEngineService';
import {
  Project,
  Panel,
  PanelRevision,
  Character,
  ScriptShot,
  ServiceStatus,
  GenerationProgress,
  CharacterGenerationProgress,
  StyleProfile,
  License,
  StructuredPrompt,
} from './types';
import {
  STYLE_CLASSIC_STORYBOARD,
  STYLE_VAULT,
} from './data/StyleVault';
import { getAspectRatio, safeGetAspectRatio, DEFAULT_ASPECT_RATIO_ID } from './data/AspectRatios';

const DEFAULT_STYLE: StyleProfile = STYLE_CLASSIC_STORYBOARD;

/** Patch a pre-Phase-8 StyleProfile that lacks id/negativePrompt/tier. */
function migrateStyleProfile(style: Partial<StyleProfile> & { name: string; promptSuffix: string }): StyleProfile {
  if (style.id) return style as StyleProfile; // already a full vault entry
  // Match by promptSuffix (more stable than name across renames)
  const match = STYLE_VAULT.find((s) => s.promptSuffix === style.promptSuffix);
  if (match) return match;
  // Unknown legacy style — wrap it with safe defaults
  const slug = style.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return {
    id: `legacy-${slug}`,
    name: style.name,
    description: style.name,
    loraName: style.loraName ?? null,
    promptSuffix: style.promptSuffix,
    negativePrompt: '',
    tier: 'community',
    previewImageUrl: null,
  };
}

function createEmptyProject(title = 'Untitled Project'): Project {
  return {
    id: `proj_${Date.now()}`,
    title,
    panels: [],
    characters: [],
    style: DEFAULT_STYLE,
    aspectRatioId: DEFAULT_ASPECT_RATIO_ID,
    filePath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createEmptyPanel(order: number): Panel {
  return {
    id: `panel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    order,
    shotDescription: '',
    structuredPrompt: null,
    generatedImagePath: null,
    generatedImageData: null,
    shotType: null,
    angle: null,
    mood: null,
    characters: [],
    notes: '',
    duration: 3,
    motionDescription: '',
    motionClipPath: null,
    motionClipData: null,
    poseClipPath: null,
    poseClipData: null,
    voicePath: null,
    voiceCharacterId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface ElectronAPI {
  // Project persistence
  saveProject: (data: unknown, filePath: string) => Promise<{ success: boolean; error?: string }>;
  loadProject: (filePath: string) => Promise<{ success: boolean; data?: Project; error?: string }>;
  showSaveDialog: (opts: object) => Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog: (opts: object) => Promise<{ canceled: boolean; filePaths?: string[] }>;
  showExportDialog: (opts: object) => Promise<{ canceled: boolean; filePath?: string }>;

  // Image / video
  saveImage: (base64: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  readImage: (filePath: string) => Promise<{ success: boolean; base64?: string; error?: string }>;
  saveVideo: (base64: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Production Pack exports
  exportPDF: (base64Data: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  exportFCPXML: (xmlString: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;

  // Animatic export
  exportAnimatic: (panelList: unknown[], outputPath: string) => Promise<{ success: boolean; error?: string }>;
  onAnimaticProgress: (cb: (percent: number) => void) => () => void;

  // Motion Comic export
  exportMotionComic: (payload: unknown) => Promise<{ success: boolean; error?: string }>;
  onMotionComicProgress: (cb: (pct: number) => void) => () => void;

  // Pose Engine / ControlNet
  onPoseAnimationProgress: (cb: (data: { pct: number; msg: string }) => void) => () => void;
  checkControlnetOpenpose: () => Promise<{ installed: boolean }>;
  downloadControlnetOpenpose: () => Promise<{ success: boolean; error?: string }>;
  onControlnetDownloadProgress: (cb: (data: { pct: number; msg: string }) => void) => () => void;

  // ComfyUI
  deleteComfyInputFile: (filename: string) => Promise<{ success: boolean; error?: string }>;
  interruptComfyUI: () => Promise<{ success: boolean; error?: string }>;

  // App info
  getAppDataPath: () => Promise<string>;
  openFolder: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;

  // Bundled engine / model downloads
  getServiceLaunchStatus: () => Promise<{ autoStartAttempted: boolean; ollama: boolean; comfyui: boolean; modelPresent: boolean }>;
  downloadModels: () => Promise<{ success: boolean; cached?: boolean; error?: string }>;
  onDownloadModelProgress: (cb: (data: { pct: number; downloaded: number; total: number }) => void) => () => void;
  downloadProModel: () => Promise<{ success: boolean; cached?: boolean; error?: string }>;
  onProModelProgress: (cb: (data: { pct: number; downloaded: number; total: number }) => void) => () => void;
  downloadAbsoluteReality: () => Promise<{ success: boolean; cached?: boolean; error?: string }>;
  onAbsoluteRealityProgress: (cb: (data: { pct: number; downloaded: number; total: number }) => void) => () => void;

  // Service health checks
  checkOllama: () => Promise<{ ok: boolean }>;
  checkComfyUI: () => Promise<{ ok: boolean }>;
  getComfyUIProxyPort: () => Promise<number>;

  // System info
  getSystemMemory: () => Promise<{ totalMem: number; freeMem: number }>;

  // Motion Library
  getMotionLibraryIndex: () => Promise<{ success: boolean; clips?: unknown[]; error?: string }>;
  getMotionClipSequence: (clipId: string) => Promise<{ success: boolean; sequence?: unknown; error?: string }>;
  applyMotionClip: (params: unknown) => Promise<{ success: boolean; error?: string }>;
  extractVideoPose: (videoPath: string) => Promise<{ success: boolean; error?: string }>;
  onMotionClipProgress: (cb: (data: { pct: number; msg: string }) => void) => () => void;

  // Video Transfer
  validateTransferVideo: (filePath: string) => Promise<{ success: boolean; duration?: number; frameCount?: number; error?: string }>;
  extractTransferPoses: (filePath: string) => Promise<{ success: boolean; sequence?: unknown; sequencePath?: string; tempDir?: string; frameCount?: number; duration?: number; usedSynthetic?: boolean; error?: string }>;
  cleanupTransferFrames: (tempDir: string) => Promise<{ success: boolean; error?: string }>;
  onTransferPoseProgress: (cb: (data: { pct: number; msg: string }) => void) => () => void;

  // Credits
  getCredits: () => Promise<{ subscriptionCredits: number; topUpCredits: number }>;
  spendCredits: (cost: number) => Promise<{ success: boolean; error?: string }>;
  setCredits: (bal: number) => Promise<{ success: boolean }>;
  resetCredits: () => Promise<{ success: boolean }>;

  // License / Dodo Payments
  validateLicense: (key: string) => Promise<{ success: boolean; tier?: string; error?: string }>;
  getLicense: () => Promise<{ tier: string; key?: string } | null>;
  saveLicense: (license: unknown) => Promise<{ success: boolean }>;
  clearLicense: () => Promise<{ success: boolean }>;
  openCheckout: (tier: string) => Promise<void>;
  openCustomerPortal: () => Promise<void>;
  validateTopup: (code: string) => Promise<{ success: boolean; credits?: number; error?: string }>;
  openTopupCheckout: (pack: string) => Promise<void>;

  // Voice Layer
  checkCoquiTTS: () => Promise<{ installed: boolean }>;
  getVoiceLibrary: () => Promise<{ success: boolean; voices?: unknown[]; error?: string }>;
  getVoiceSample: (voiceId: string) => Promise<{ success: boolean; audioBase64?: string; error?: string }>;
  generateVoice: (params: { text: string; voiceId: string; speed?: number }) => Promise<{ success: boolean; audioPath?: string; error?: string }>;
  installCoquiTTS: () => Promise<{ success: boolean; error?: string }>;
  cloneVoice: (params: { audioPath: string; voiceName: string }) => Promise<{ success: boolean; voiceId?: string; error?: string }>;
  generateClonedVoice: (params: { text: string; voiceId: string; provider: string }) => Promise<{ success: boolean; audioPath?: string; error?: string }>;
  checkVoiceCloneProviders: () => Promise<{ cartesia: boolean; elevenlabs: boolean; preferred: string | null }>;
  saveElevenLabsKey: (params: { key: string }) => Promise<{ success: boolean }>;
  getCustomVoices: () => Promise<{ success: boolean; voices?: unknown[] }>;
  saveCustomVoice: (params: unknown) => Promise<{ success: boolean; error?: string }>;
  deleteCustomVoice: (params: { voiceId: string }) => Promise<{ success: boolean; error?: string }>;
  getEdgeTtsVoices: () => Promise<{ success: boolean; voices?: unknown[]; error?: string }>;
  previewVoice: (params: { voiceId: string; text?: string }) => Promise<{ success: boolean; audioBase64?: string; error?: string }>;
  readFileAsBase64: (filePath: string) => Promise<{ success: boolean; base64?: string; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  exportPanelWithVoice: (params: unknown) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  onJoinSharedProject: (cb: (data: { projectId: string }) => void) => () => void;
  onSharedStudioJoin: (cb: (data: { projectId: string; supabaseUrl?: string }) => void) => () => void;
  onVoiceProgress: (cb: (pct: number) => void) => () => void;
  onInstallProgress: (cb: (msg: string) => void) => () => void;

  // Cloud API proxy
  falFluxSchnell: (params: unknown) => Promise<unknown>;
  falIPAdapter: (params: unknown) => Promise<unknown>;
  falFluxFill: (params: unknown) => Promise<unknown>;
  falKling: (params: unknown) => Promise<unknown>;
  cancelFalKling: () => void;
  falSeedance: (params: unknown) => Promise<unknown>;
  falVeo: (params: unknown) => Promise<unknown>;
  falWanMotion: (params: unknown) => Promise<unknown>;
  cancelFalVideo: () => void;
  uploadVideoToFal: (videoPath: string) => Promise<{ success: boolean; url?: string; error?: string }>;
  syncsoLipSync: (params: unknown) => Promise<unknown>;
  deepSeekShot: (params: unknown) => Promise<unknown>;
  deepSeekScreenplay: (params: unknown) => Promise<unknown>;
  onCloudProgress: (cb: (data: { pct: number; msg: string }) => void) => () => void;

  // Brand LoRA Training
  uploadTrainingImages: (params: { imagePaths: string[] }) => Promise<{ success: boolean; urls?: string[]; error?: string }>;
  startLoraTraining: (params: { imageUrls: string[]; styleName: string; triggerWord: string }) => Promise<{ success: boolean; requestId?: string; error?: string }>;
  pollLoraTraining: (params: { requestId: string }) => Promise<{ success: boolean; status?: string; loraPath?: string; error?: string }>;
  installLora: (params: { loraPath: string; styleName: string }) => Promise<{ success: boolean; error?: string }>;
  getCustomStyles: () => Promise<{ success: boolean; styles?: unknown[] }>;
  saveCustomStyle: (params: unknown) => Promise<{ success: boolean; error?: string }>;
  deleteCustomStyle: (params: { styleId: string }) => Promise<{ success: boolean; error?: string }>;
  cleanupTrainingUploads: (params: unknown) => Promise<{ success: boolean; error?: string }>;
  onLoraUploadProgress: (cb: (data: { current: number; total: number; pct: number }) => void) => () => void;
  onLoraInstallProgress: (cb: (data: { pct: number; msg: string }) => void) => () => void;

  // Platform
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Module-level set of training job IDs currently being polled this session.
// Prevents duplicate polling loops when the app is opened multiple times rapidly.
const activePollingJobs = new Set<string>();

// Computed once at module load — both constants share the same panel id so
// initial project state and initial activePanelId are always in sync.
const _initialPanel = createEmptyPanel(0);
const INITIAL_PROJECT: Project = { ...createEmptyProject(), panels: [_initialPanel] };
const INITIAL_PANEL_ID: string = _initialPanel.id;

export default function App() {
  const [project, setProject] = useState<Project>(INITIAL_PROJECT);
  const [activePanelId, setActivePanelId] = useState<string | null>(INITIAL_PANEL_ID);
  const [shotInput, setShotInput] = useState('');
  const [shotConstraints, setShotConstraints] = useState<ShotConstraints>({ shotType: '', angle: '', mood: '' });
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>({
    comfyui: 'checking',
    ollama: 'checking',
  });
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [charProgress, setCharProgress] = useState<CharacterGenerationProgress | null>(null);
  const [wanModelAvailable, setWanModelAvailable] = useState<boolean | null>(null);
  const [wanModelWarning, setWanModelWarning] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [isExportingMotionComic, setIsExportingMotionComic] = useState(false);
  const [motionComicProgress, setMotionComicProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cloudToast, setCloudToast] = useState<string | null>(null);
  // Phase 6B — Pose Engine
  const [showPoseEditor, setShowPoseEditor] = useState(false);
  const [isPoseGenerating, setIsPoseGenerating] = useState(false);
  // Phase 6C — Motion Library
  const [showMotionLibrary, setShowMotionLibrary] = useState(false);
  // Phase 6E — Video Transfer
  const [showVideoTransfer, setShowVideoTransfer] = useState(false);
  // Phase 15 — Voice Studio
  const [showVoiceStudio, setShowVoiceStudio] = useState(false);
  // Keyed by panelId so the lock survives VoiceStudio modal unmount/remount
  const [voiceGenerationState, setVoiceGenerationState] = useState<Map<string, 'idle' | 'generating'>>(new Map());
  const isVoiceGenerating = (panelId: string) => voiceGenerationState.get(panelId) === 'generating';
  const setVoiceGenerating = (panelId: string, state: 'idle' | 'generating') =>
    setVoiceGenerationState((prev) => { const next = new Map(prev); next.set(panelId, state); return next; });
  // Legacy scalar kept for isPanelGenerating compatibility — derived from map
  const voiceGeneratingPanelId = Array.from(voiceGenerationState.entries()).find(([, v]) => v === 'generating')?.[0] ?? null;
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('imagginary_onboarded'));
  const [welcomeDismissible, setWelcomeDismissible] = useState(false);
  const [showScriptReader, setShowScriptReader] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showLoraTrainer, setShowLoraTrainer] = useState(false);
  const [customStylesLoaded, setCustomStylesLoaded] = useState(false);
  // Phase 14 — true when the main process auto-started Ollama + ComfyUI successfully
  const [servicesAutoStarted, setServicesAutoStarted] = useState(false);
  // License
  const [license, setLicense] = useState<License | null>(null);
  const currentTier = getTier(licenseService);
  const tierAccent = TIER_COLORS[currentTier].accent;
  const [showActivateLicense, setShowActivateLicense] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Model recovery banner
  const [modelMissing, setModelMissing] = useState(false);
  const [modelDownloading, setModelDownloading] = useState(false);
  const [modelDownloadPct, setModelDownloadPct] = useState(0);
  // Pro model upgrade banner
  const [proModelInstalled, setProModelInstalled] = useState(false);
  const [proModelDownloading, setProModelDownloading] = useState(false);
  const [proModelPct, setProModelPct] = useState(0);
  // Phase 13 — Shared Studio
  const [isSharedSession, setIsSharedSession] = useState(false);
  const [sessionUsers, setSessionUsers] = useState<Array<{ userId: string; userName: string }>>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSharedStudioOnboarding, setShowSharedStudioOnboarding] = useState(false);
  const [collaboratorCursors, setCollaboratorCursors] = useState<Map<string, { userId: string; userName: string; panelId: string | null; x: number; y: number }>>(new Map());
  const [sharedStudioConnectionStatus, setSharedStudioConnectionStatus] = useState<SharedStudioConnectionStatus>('disconnected');
  const cursorBroadcastThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  // projectRef — always holds the latest project so callbacks registered once (deep-link
  // join, SharedStudio request_state responder) never read a stale closure value.
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);
  const [estimatedGenerationSeconds, setEstimatedGenerationSeconds] = useState<number | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPath = useRef<string | null>(null);

  // ── Phase 14: read auto-start result from main process ──────────────────────
  useEffect(() => {
    if (!window.electronAPI?.getServiceLaunchStatus) return;
    window.electronAPI.getServiceLaunchStatus().then((status) => {
      if (!status?.autoStartAttempted) return;
      const bothOk =
        (status.ollama === 'started' || status.ollama === 'external') &&
        (status.comfyui === 'started' || status.comfyui === 'external');
      setServicesAutoStarted(bothOk);
    });
  }, []);

  // ── Telemetry init ───────────────────────────────────────────────────────────
  useEffect(() => {
    telemetryService.init();
  }, []);

  // ── Tier accent CSS variables ─────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty('--tier-accent', tierAccent);
    document.documentElement.style.setProperty('--tier-accent-20', `${tierAccent}20`);
    document.documentElement.style.setProperty('--tier-accent-40', `${tierAccent}40`);
  }, [tierAccent]);

  // ── Settings + License load ───────────────────────────────────────────────────
  useEffect(() => {
    settingsService.load();
    licenseService.load().then(() => setLicense(licenseService.getLicense()));
    customStyleService.load().then(() => {
      setCustomStylesLoaded(true);
      // Resume polling for any training jobs that were in-progress when the app closed
      const inProgress = customStyleService.getCustomStyles()
        .filter(s => s.trainingStatus === 'training' && s.trainingJobId);
      for (const style of inProgress) {
        resumeLoraPolling(style);
      }
    });
  }, []);

  const resumeLoraPolling = async (style: StyleProfile) => {
    // Idempotency: skip if already complete/failed (could happen on rapid restart)
    if (style.trainingStatus !== 'training') return;
    // Dedup: only one poller per job per process lifetime
    if (!style.trainingJobId || activePollingJobs.has(style.trainingJobId)) return;
    activePollingJobs.add(style.trainingJobId);

    try {
    for (let i = 0; i < 80; i++) {
      await new Promise<void>(r => setTimeout(r, 15000));
      try {
        const result = await window.electronAPI?.pollLoraTraining?.({ requestId: style.trainingJobId });
        if (!result.success) continue;

        if (result.status === 'COMPLETED') {
          const installResult = await window.electronAPI!.installLora({
            loraUrl: result.loraUrl,
            loraName: style.loraName,
          });
          if (installResult.success) {
            comfyUIService.invalidateLoraCache();
            await customStyleService.saveCustomStyle({
              ...style,
              trainingStatus: 'complete',
              loraPath: installResult.userLoraPath,
              loraName: installResult.fileName.replace('.safetensors', ''),
            });
            setCustomStylesLoaded(prev => !prev);
            setCloudToast(`✦ "${style.name}" brand style is ready!`);
            setTimeout(() => setCloudToast(null), 5000);
          }
          break;
        }

        if (result.status === 'FAILED') {
          await customStyleService.saveCustomStyle({ ...style, trainingStatus: 'failed' });
          setCustomStylesLoaded(prev => !prev);
          break;
        }
      } catch { /* network error — keep polling */ }
    }
    } finally {
      activePollingJobs.delete(style.trainingJobId);
    }
  };

  // ── Hardware speed estimate (for slow-machine hint in ShotInput) ──────────────
  useEffect(() => {
    window.electronAPI?.getSystemMemory?.().then((info) => {
      if (info.speedCategory === 'slow') {
        const estimate = info.isAppleSilicon
          ? info.totalGB >= 8 ? 180 : 300
          : 240;
        setEstimatedGenerationSeconds(estimate);
      }
    }).catch(() => {});
  }, []);

  // ── Service status polling ───────────────────────────────────────────────────
  const checkServicesRef = useRef<() => Promise<void>>();

  useEffect(() => {
    async function checkServices() {
      const [ollamaOk, comfyStatus] = await Promise.all([
        ollamaService.checkConnection(),
        comfyUIService.checkConnection(),
      ]);
      setServiceStatus({
        ollama: ollamaOk ? 'connected' : 'disconnected',
        comfyui: comfyStatus.connected ? 'connected' : 'disconnected',
      });
      if (comfyStatus.connected) {
        comfyUIService.checkWanModelAvailability().then((r) => {
          setWanModelAvailable(r.available);
          setWanModelWarning(r.warning);
        });
      } else {
        setWanModelAvailable(null);
        setWanModelWarning(undefined);
      }
    }
    checkServicesRef.current = checkServices;
    checkServices();
    const interval = setInterval(checkServices, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Model health check — show recovery banner if ComfyUI has no checkpoints ──
  useEffect(() => {
    if (serviceStatus.comfyui !== 'connected') return;
    comfyUIService.getAvailableCheckpoints().then((checkpoints) => {
      setModelMissing(checkpoints.length === 0);
      setProModelInstalled(checkpoints.some((c) => /realvisxl/i.test(c)));
    }).catch(() => { /* Can't determine — leave banner hidden */ });
  }, [serviceStatus.comfyui]);

  // ── Auto-save ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (lastSavedPath.current) saveProjectToPath(lastSavedPath.current, project);
    }, 30000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [project]);

  const activePanel = project.panels.find((p) => p.id === activePanelId) ?? null;
  const hasMotionClips = project.panels.some((p) => p.motionClipPath || p.motionClipData);
  const isPanelGenerating = (panelId: string) =>
    (progress !== null &&
      progress.panelId === panelId &&
      progress.status !== 'complete' &&
      progress.status !== 'error') ||
    voiceGeneratingPanelId === panelId;
  const effectiveAspectRatio = safeGetAspectRatio(
    activePanel?.aspectRatioId || project.aspectRatioId || DEFAULT_ASPECT_RATIO_ID,
    licenseService.isStudio()
  );

  // ── Panel operations ─────────────────────────────────────────────────────────
  function addPanel() {
    const panel = createEmptyPanel(project.panels.length);
    setProject((prev) => ({ ...prev, panels: [...prev.panels, panel], updatedAt: Date.now() }));
    setActivePanelId(panel.id);
    setShotInput('');
  }

  function deletePanel(id: string) {
    setProject((prev) => {
      const panels = prev.panels.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i }));
      return { ...prev, panels, updatedAt: Date.now() };
    });
    if (activePanelId === id) {
      const remaining = project.panels.filter((p) => p.id !== id);
      setActivePanelId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  }

  function updatePanel(id: string, updates: Partial<Panel>) {
    setProject((prev) => ({
      ...prev,
      panels: prev.panels.map((p) => p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p),
      updatedAt: Date.now(),
    }));
  }

  function reorderPanels(panels: Panel[]) {
    setProject((prev) => ({ ...prev, panels, updatedAt: Date.now() }));
  }

  // ── Character operations ─────────────────────────────────────────────────────

  /** Full character creation flow: ComfyUI portrait generation */
  async function handleCreateCharacter(name: string, description: string) {
    if (serviceStatus.comfyui !== 'connected') {
      setCharProgress({ characterId: '', stage: 'error', error: 'ComfyUI must be running to generate a character reference. Check the status indicators in the top bar.' });
      return;
    }

    // Create placeholder immediately so it shows in the list
    const character = characterLibraryService.create(name, description, project.id);

    setProject((prev) => ({
      ...prev,
      characters: [...prev.characters, character],
      updatedAt: Date.now(),
    }));

    const charId = character.id;

    // ── Stage 1: Generate reference portrait ──────────────────────────────────
    setCharProgress({ characterId: charId, stage: 'generating-reference', message: `Generating ${name} portrait…` });

    try {
      const imageData = await comfyUIService.generateCharacterReference(
        description,
        (prog, msg) => setCharProgress({ characterId: charId, stage: 'generating-reference', message: msg })
      );

      // Save image to disk
      let savedPath: string | null = null;
      if (window.electronAPI) {
        const b64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
        const result = await window.electronAPI.saveImage(b64, `char_${charId}.png`);
        if (result.success) savedPath = result.filePath ?? null;
      }

      // Update character with reference image
      const updated = characterLibraryService.update(charId, {
        referenceImagePath: savedPath,
        referenceImageData: imageData,
      });

      if (updated) {
        setProject((prev) => ({
          ...prev,
          characters: prev.characters.map((c) => c.id === charId ? updated : c),
          updatedAt: Date.now(),
        }));
      }

      setCharProgress({ characterId: charId, stage: 'complete', message: `${name} created` });
      setTimeout(() => setCharProgress(null), 3000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setCharProgress({ characterId: charId, stage: 'error', message: 'Character generation failed', error: msg });
    }
  }

  function deleteCharacter(id: string) {
    characterLibraryService.delete(id);
    setProject((prev) => ({
      ...prev,
      characters: prev.characters.filter((c) => c.id !== id),
      panels: prev.panels.map((p) => ({ ...p, characters: p.characters.filter((cid) => cid !== id) })),
      updatedAt: Date.now(),
    }));
  }

  // ── Panel generation ─────────────────────────────────────────────────────────
  async function generate(
    panelId: string,
    description: string,
    overrideCharacterIds?: string[],
    overrideConstraints?: Partial<ShotConstraints>,
    panelOverride?: Panel,
  ) {
    if (!description.trim()) return;
    if (serviceStatus.ollama !== 'connected') return;

    setProgress({ panelId, status: 'parsing', progress: 0, message: 'Parsing shot description…' });

    try {
      // Prefer explicit panelOverride so callers that create a panel and immediately call
      // generate() don't read stale React state before setProject() has committed.
      const panel = panelOverride ?? project.panels.find((p) => p.id === panelId);
      const resolvedShotType = overrideConstraints?.shotType || panel?.shotType || '';
      const resolvedAngle    = overrideConstraints?.angle    || panel?.angle    || '';
      const resolvedMood     = overrideConstraints?.mood     || panel?.mood     || '';
      const constraints = [
        resolvedShotType ? `Shot type: ${resolvedShotType}`    : '',
        resolvedAngle    ? `Camera angle: ${resolvedAngle}`    : '',
        resolvedMood     ? `Mood: ${resolvedMood}`             : '',
      ].filter(Boolean).join('. ');
      const fullDescription = constraints ? `${constraints}. ${description}` : description;

      // Re-parse only when shot description has changed or no structured prompt exists yet.
      // Preserves any manual edits to structuredPrompt fields when regenerating unchanged shots.
      const needsReparse = !panel?.structuredPrompt || panel.shotDescription !== description;
      const structuredPrompt: StructuredPrompt = needsReparse
        ? await ollamaService.parseShot(fullDescription)
        : panel!.structuredPrompt!;

      // Always overwrite additionalDetails with the full raw prompt after a fresh parse
      // so specific details are never lost even if parsing is imperfect.
      // Skipped when reusing an existing structuredPrompt (needsReparse === false),
      // which preserves any manual edits the user made to additionalDetails.
      if (needsReparse) {
        structuredPrompt.additionalDetails = fullDescription;
      }

      // Preserve user's pre-set constraints — fall back to parsed values only if unset
      updatePanel(panelId, {
        shotDescription: description,
        structuredPrompt,
        shotType: resolvedShotType || structuredPrompt.shotType,
        angle:    resolvedAngle    || structuredPrompt.angle,
        mood:     resolvedMood     || structuredPrompt.mood,
      });

      setProgress({ panelId, status: 'generating', progress: 15, message: 'Sending to ComfyUI…' });

      if (serviceStatus.comfyui !== 'connected') {
        setProgress({ panelId, status: 'error', progress: 0, message: 'ComfyUI offline', error: 'ComfyUI is not running — check your service URL in Settings → Advanced.' });
        return;
      }

      // Pass character IDs so generateImage can resolve IP-Adapter references.
      // overrideCharacterIds is used by handleScriptGenerate to avoid stale closure issues
      // when panels are batch-created before sequential generation begins.
      const characterIds = overrideCharacterIds ?? panel?.characters ?? [];

      // Resolve effective aspect ratio: panel override → project default → global default.
      // safeGetAspectRatio enforces tier restrictions — if the stored ratio is Studio-only
      // and the current user isn't Studio (e.g. they received a shared project), it falls
      // back to the standard 16:9 ratio so the restricted resolution is never sent to ComfyUI.
      const requestedAspectRatio = getAspectRatio(
        panel?.aspectRatioId || project.aspectRatioId || DEFAULT_ASPECT_RATIO_ID
      );
      const effectiveAspectRatio = safeGetAspectRatio(
        panel?.aspectRatioId || project.aspectRatioId || DEFAULT_ASPECT_RATIO_ID,
        licenseService.isStudio()
      );
      if (effectiveAspectRatio.id !== requestedAspectRatio.id) {
        setCloudToast(
          `Broadcast HD (${requestedAspectRatio.label}) is Studio-only — generating at ${effectiveAspectRatio.label} instead.`
        );
        setTimeout(() => setCloudToast(null), 5000);
      }

      // Inject Director's Notes into the prompt if present
      const notesText = panel?.notes?.trim();
      const promptWithNotes: StructuredPrompt = notesText
        ? {
            ...structuredPrompt,
            additionalDetails: [structuredPrompt.additionalDetails, notesText]
              .filter(Boolean)
              .join(', '),
          }
        : structuredPrompt;

      const imageData = await comfyUIService.generateImage(
        promptWithNotes,
        effectiveAspectRatio,
        (prog, msg) => setProgress({ panelId, status: 'generating', progress: 15 + (prog * 0.85), message: msg }),
        characterIds,
        project.style,
        resolvedAngle || structuredPrompt.angle
      );

      // One-time toast confirming cloud generation worked — shown on first successful Pro generate
      if (licenseService.isPro() || licenseService.isStudio()) {
        if (!localStorage.getItem('imagginary_first_cloud_gen_done')) {
          localStorage.setItem('imagginary_first_cloud_gen_done', '1');
          setCloudToast('✦ Generated via FLUX.1 Schnell in the cloud');
          setTimeout(() => setCloudToast(null), 4000);
        }
      }

      let savedPath: string | null = null;
      if (window.electronAPI) {
        const b64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
        const result = await window.electronAPI.saveImage(b64, `panel_${panelId}_${Date.now()}.png`);
        if (result.success) savedPath = result.filePath ?? null;
      }

      if (panel?.generatedImageData) {
        const newRevision: PanelRevision = {
          id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          imageData: panel.generatedImageData,
          prompt: panel.shotDescription,
          timestamp: Date.now(),
        };
        const currentRevisions = panel.revisions ?? [];
        updatePanel(panelId, {
          generatedImageData: imageData,
          generatedImagePath: savedPath,
          styleProfileId: project.style.id,
          revisions: [...currentRevisions, newRevision].slice(-20),
        });
      } else {
        updatePanel(panelId, { generatedImageData: imageData, generatedImagePath: savedPath, styleProfileId: project.style.id });
      }
      telemetryService.track('panel_generated', { style: project.style.id, hasCharacters: characterIds.length > 0 });
      setProgress({ panelId, status: 'complete', progress: 100, message: 'Complete' });
      setTimeout(() => setProgress(null), 2000);
    } catch (error) {
      // Detect model-not-found errors and surface the recovery banner
      if (
        error instanceof Error &&
        (error.message.includes('model file not found') ||
          error.message.includes('ckpt_name') ||
          error.message.includes('v1-5-pruned-emaonly'))
      ) {
        setModelMissing(true);
      }

      const isOllamaError =
        error instanceof Error &&
        (error.name === 'TimeoutError' ||
          error.message.includes('timed out') ||
          error.message.includes('Ollama'));

      if (isOllamaError && window.electronAPI?.getSystemMemory) {
        try {
          const { freeMem } = await window.electronAPI.getSystemMemory();
          const freeMB = Math.round(freeMem / (1024 * 1024));
          if (freeMem < 1.5 * 1024 * 1024 * 1024) {
            setProgress({
              panelId,
              status: 'error',
              progress: 0,
              message: 'Not enough memory to generate',
              error: `Your system only has ~${freeMB} MB free. Close Chrome or other apps and try again. Imagginary Pro runs on cloud GPUs with no RAM limits.`,
              errorLink: { label: 'Learn about Imagginary Pro →', url: 'https://imagginary.com/pro' },
            });
            return;
          }
        } catch {
          // fall through to generic error
        }
        setProgress({
          panelId,
          status: 'error',
          progress: 0,
          message: 'Generation timed out',
          error: 'Ollama took too long to respond. Try closing other apps and generating again.',
        });
      } else {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        setProgress({ panelId, status: 'error', progress: 0, message: 'Generation failed', error: msg });
      }
    }
  }

  function handleWelcomeComplete({ title, style, firstShot }: WelcomeCompleteParams) {
    // Apply project title and style from onboarding
    setProject((prev) => ({ ...prev, title, style, updatedAt: Date.now() }));
    setShotInput(firstShot);
    setShowWelcome(false);

    // Kick off first panel generation immediately. panelOverride is passed so generate()
    // doesn't need to look up the panel from React state (which may not have committed yet).
    const panel = createEmptyPanel(0);
    setProject((prev) => ({ ...prev, panels: [panel], updatedAt: Date.now() }));
    setActivePanelId(panel.id);
    generate(panel.id, firstShot, undefined, undefined, panel);
  }

  function handleGenerate() {
    const constraints = shotConstraints.shotType || shotConstraints.angle || shotConstraints.mood
      ? shotConstraints
      : undefined;
    if (!activePanelId) {
      const panel = createEmptyPanel(project.panels.length);
      setProject((prev) => ({ ...prev, panels: [...prev.panels, panel], updatedAt: Date.now() }));
      setActivePanelId(panel.id);
      setTimeout(() => generate(panel.id, shotInput, undefined, constraints), 50);
      return;
    }
    generate(activePanelId, shotInput, undefined, constraints);
  }

  function handleRegenerate() {
    if (!activePanelId || !activePanel) return;
    generate(activePanelId, shotInput || activePanel.shotDescription);
  }

  function handleUpdateStructuredPrompt(panelId: string, updates: Partial<StructuredPrompt>) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel?.structuredPrompt) return;
    updatePanel(panelId, {
      structuredPrompt: { ...panel.structuredPrompt, ...updates },
    });
  }

  // ── Project persistence ──────────────────────────────────────────────────────
  async function saveProjectToPath(filePath: string, proj: Project) {
    if (!window.electronAPI) return;
    await window.electronAPI.saveProject(proj, filePath);
    lastSavedPath.current = filePath;
  }

  async function handleSave() {
    if (!window.electronAPI) return;
    setIsSaving(true);
    try {
      let filePath = lastSavedPath.current ?? project.filePath;
      if (!filePath) {
        const result = await window.electronAPI.showSaveDialog({
          title: 'Save Project',
          defaultPath: `${project.title}.imagginary`,
          filters: [{ name: 'Imagginary', extensions: ['imagginary'] }],
        });
        if (result.canceled || !result.filePath) return;
        filePath = result.filePath;
      }
      const updated = { ...project, filePath, updatedAt: Date.now() };
      setProject(updated);
      await saveProjectToPath(filePath, updated);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoad() {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.showOpenDialog({
      title: 'Open Project',
      filters: [{ name: 'Imagginary', extensions: ['imagginary'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.[0]) return;

    const loadResult = await window.electronAPI.loadProject(result.filePaths[0]);
    if (!loadResult.success || !loadResult.data) {
      setLoadError(`Could not open project: ${loadResult.error ?? 'File may be corrupted or from an older version.'}`);
      return;
    }

    const loaded = loadResult.data;
    // Migrate pre-Phase-8 StyleProfile (missing id/negativePrompt/tier)
    const migratedStyle = migrateStyleProfile(loaded.style as Partial<StyleProfile> & { name: string; promptSuffix: string });
    let migratedProject = migratedStyle !== loaded.style ? { ...loaded, style: migratedStyle } : loaded;
    // Migrate projects that predate aspect ratio support
    if (!migratedProject.aspectRatioId) {
      migratedProject = { ...migratedProject, aspectRatioId: DEFAULT_ASPECT_RATIO_ID };
    }
    // Migrate panels that predate Phase 6B (add poseClipPath / poseClipData defaults)
    const panelsNeedMigration = migratedProject.panels.some(
      (p) => p.poseClipPath === undefined || p.poseClipData === undefined
    );
    if (panelsNeedMigration) {
      migratedProject = {
        ...migratedProject,
        panels: migratedProject.panels.map((p) => ({
          ...p,
          poseClipPath: p.poseClipPath ?? null,
          poseClipData: p.poseClipData ?? null,
        })),
      };
    }
    setProject(migratedProject);
    lastSavedPath.current = migratedProject.filePath;
    characterLibraryService.loadFromProject(migratedProject.characters);
    setActivePanelId(migratedProject.panels.length > 0 ? migratedProject.panels[0].id : null);
    // Auto-save after migration so the file is updated on disk
    if (migratedStyle !== loaded.style && migratedProject.filePath) {
      saveProjectToPath(migratedProject.filePath, migratedProject);
    }
  }

  function handleNewProject() {
    const proj = createEmptyProject('Untitled Project');
    const firstPanel = createEmptyPanel(0);
    setProject({ ...proj, panels: [firstPanel] });
    setActivePanelId(firstPanel.id);
    setShotInput('');
    setProgress(null);
    setCharProgress(null);
    lastSavedPath.current = null;
    characterLibraryService.loadFromProject([]);
  }

  // ── Phase 13 — Shared Studio ──────────────────────────────────────────────────
  function handleSharedStudioEvent(event: SharedStudioEvent) {
    switch (event.type) {
      case 'project_update':
        setProject((prev) => {
          // Merge characters: keep local additions not yet in the remote payload
          const remoteCharIds = new Set(event.project.characters.map((c) => c.id));
          const localOnlyChars = prev.characters.filter((c) => !remoteCharIds.has(c.id));
          const mergedCharacters = [...event.project.characters, ...localOnlyChars];

          // Merge panels: keep local additions not yet reflected in the remote payload
          const remotePanelIds = new Set(event.project.panels.map((p) => p.id));
          const localOnlyPanels = prev.panels.filter((p) => !remotePanelIds.has(p.id));

          const mergedPanels = [
            ...event.project.panels.map((incomingPanel) => {
              const localPanel = prev.panels.find((p) => p.id === incomingPanel.id);
              if (!localPanel) return incomingPanel;
              // Keep local panel unchanged while it's actively generating (ref avoids stale closure)
              if (progressRef.current?.panelId === localPanel.id) return localPanel;
              // Preserve local binary data and per-machine history — remote strips these before broadcasting
              return {
                ...incomingPanel,
                generatedImageData: localPanel.generatedImageData,
                motionClipData: localPanel.motionClipData,
                voiceClipData: localPanel.voiceClipData,
                poseClipData: localPanel.poseClipData,
                editHistory: localPanel.editHistory,
                revisions: localPanel.revisions,
              };
            }),
            // Append panels added locally that haven't been broadcast yet
            ...localOnlyPanels,
          ];

          const mergedProject = {
            ...event.project,
            characters: mergedCharacters,
            panels: mergedPanels,
          };

          // If the active panel was deleted by a collaborator, redirect to the first available panel
          // We need activePanelId from outer scope — read it via the ref pattern isn't needed here
          // because setActivePanelId is a stable dispatch and this runs synchronously in the updater
          setActivePanelId((currentActivePanelId) => {
            const stillExists = mergedPanels.some((p) => p.id === currentActivePanelId);
            if (!stillExists) {
              // Show toast outside the updater — schedule via setTimeout to avoid setState-in-setState
              if (currentActivePanelId && prev.panels.some((p) => p.id === currentActivePanelId)) {
                setTimeout(() => setCloudToast('A collaborator removed the panel you were viewing'), 0);
                setTimeout(() => setCloudToast(null), 4000);
              }
              return mergedPanels.length > 0 ? mergedPanels[0].id : null;
            }
            return currentActivePanelId;
          });

          return mergedProject;
        });
        break;
      case 'state_response':
        if (event.targetUserId !== sharedStudioService.getUserId()) return;
        setProject((prev) => {
          // Only apply if we joined with an empty project — first response wins
          if (prev.panels.length > 0 && prev.panels.some(p => p.shotDescription || p.generatedImagePath)) return prev;
          return { ...event.project, panels: event.project.panels };
        });
        break;
      case 'cursor':
        setCollaboratorCursors(prev => {
          const next = new Map(prev);
          if (event.x === -1 && event.y === -1) {
            next.delete(event.userId);
          } else {
            next.set(event.userId, { userId: event.userId, userName: event.userName, panelId: event.panelId, x: event.x, y: event.y });
          }
          return next;
        });
        break;
      case 'user_joined':
        setSessionUsers((prev) => [
          ...prev.filter((u) => u.userId !== event.userId),
          { userId: event.userId, userName: event.userName },
        ]);
        break;
      case 'user_left':
        setSessionUsers((prev) => prev.filter((u) => u.userId !== event.userId));
        setCollaboratorCursors(prev => { const next = new Map(prev); next.delete(event.userId); return next; });
        break;
    }
  }

  // Keep a stable ref to handleSharedStudioEvent so useEffect callbacks registered
  // with an empty dep array (mount-only) always call the latest version of the handler,
  // not the stale closure captured at mount time.
  const handleSharedStudioEventRef = useRef(handleSharedStudioEvent);
  useEffect(() => { handleSharedStudioEventRef.current = handleSharedStudioEvent; });

  async function startSharedSession() {
    if (!licenseService.isStudio()) return;
    if (!sharedStudioService.isConfigured()) {
      setShowSharedStudioOnboarding(true);
      return;
    }
    const joined = await sharedStudioService.joinProject(project.id, handleSharedStudioEventRef.current, () => projectRef.current);
    if (joined) setIsSharedSession(true);
  }

  function handleCopyInviteLink() {
    const supabaseUrl = settingsService.getKey('supabaseUrl') || '';
    if (!project.id || !supabaseUrl) return;
    const link = `imagginary://join?project=${encodeURIComponent(project.id)}&supabase=${encodeURIComponent(supabaseUrl)}`;
    navigator.clipboard.writeText(link);
  }

  async function handleLeaveSharedSession() {
    await sharedStudioService.leaveProject();
    setIsSharedSession(false);
    setSessionUsers([]);
    setCollaboratorCursors(new Map());
  }

  function handleCursorMove(panelId: string, x: number, y: number) {
    if (!isSharedSession) return;
    if (cursorBroadcastThrottle.current) return;
    cursorBroadcastThrottle.current = setTimeout(() => {
      cursorBroadcastThrottle.current = null;
    }, 50);
    sharedStudioService.broadcastCursor(panelId, x, y);
  }

  // Register connection-status listener whenever a shared session is active
  useEffect(() => {
    if (!isSharedSession) return;
    sharedStudioService.setConnectionStatusListener(setSharedStudioConnectionStatus);
    return () => sharedStudioService.setConnectionStatusListener(() => {});
  }, [isSharedSession]);

  // Broadcast project updates to teammates (1 second debounce)
  useEffect(() => {
    if (!isSharedSession) return;
    const timer = setTimeout(() => {
      sharedStudioService.broadcastProjectUpdate(project);
    }, 1000);
    return () => clearTimeout(timer);
  }, [project, isSharedSession]);

  // Listen for deep-link join events from electron main process
  useEffect(() => {
    if (!window.electronAPI?.onSharedStudioJoin) return;
    const cleanup = window.electronAPI.onSharedStudioJoin(({ projectId, supabaseUrl }: { projectId: string; supabaseUrl?: string }) => {
      if (!licenseService.isStudio()) {
        setCloudToast('This invite requires a Studio subscription to join');
        setTimeout(() => setCloudToast(null), 5000);
        return;
      }
      if (supabaseUrl) settingsService.save({ supabaseUrl });
      if (!sharedStudioService.isConfigured()) { setShowSettings(true); return; }
      sharedStudioService.joinProject(projectId, handleSharedStudioEventRef.current, () => projectRef.current).then((ok) => {
        if (ok) setIsSharedSession(true);
      });
    });
    return cleanup;
  }, []);

  async function handleGenerateAnimatic() {
    setIsExporting(true);
    setExportProgress(0);
    try {
      const result = await animaticExporter.export(project.panels, (percent) => setExportProgress(percent));
      if (result.success) telemetryService.track('animatic_exported', { panelCount: project.panels.length });
      if (!result.success) {
        setExportError(result.error ?? 'Export failed. Please try again.');
        setTimeout(() => setExportError(null), 5000);
      }
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }

  async function handleExportMotionComic() {
    setIsExportingMotionComic(true);
    setMotionComicProgress(0);
    try {
      const result = await motionComicExporter.export(project.panels, setMotionComicProgress);
      if (!result.success) {
        setExportError(result.error ?? 'Export failed. Please try again.');
        setTimeout(() => setExportError(null), 5000);
      }
    } finally {
      setIsExportingMotionComic(false);
      setMotionComicProgress(0);
    }
  }

  // ── Phase 7 — Script Reader ───────────────────────────────────────────────────
  /**
   * Sequential panel generation from a parsed screenplay.
   * Generates one panel at a time — architectural constraint of local ComfyUI processing.
   * A future cloud/parallel implementation can replace this loop without changing callers.
   */
  async function handleScriptGenerate(
    shots: ScriptShot[],
    onProgress: (current: number, total: number) => void
  ): Promise<void> {
    if (shots.length === 0) return;

    // Create all panels upfront with character IDs pre-assigned
    const baseOrder = project.panels.length;
    const newPanels: Panel[] = shots.map((shot, i) => ({
      ...createEmptyPanel(baseOrder + i),
      shotDescription: shot.shotDescription,
      characters: shot.assignedCharacterIds,
    }));

    const firstNewPanelId = newPanels[0].id;

    // Add all panels in one state update, then select the first one
    setProject((prev) => ({
      ...prev,
      panels: [...prev.panels, ...newPanels],
      updatedAt: Date.now(),
    }));
    setActivePanelId(firstNewPanelId);

    // Generate sequentially — one at a time because ComfyUI processes one job at a time
    for (let i = 0; i < newPanels.length; i++) {
      onProgress(i + 1, newPanels.length);
      try {
        // Pass the panel object directly so generate() never reads stale React state.
        // overrideCharacterIds is also passed for clarity, though panelOverride.characters has the same value.
        await generate(newPanels[i].id, shots[i].shotDescription, shots[i].assignedCharacterIds, undefined, newPanels[i]);
      } catch (err) {
        // Log and continue — don't abort the sequence on a single panel failure
        console.error(`Script generation: panel ${i + 1} of ${newPanels.length} failed:`, err);
      }
    }

    onProgress(newPanels.length, newPanels.length);
  }

  async function handleInpaintEdit(panelId: string, maskData: string, editDescription: string) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel?.generatedImageData) return;

    setProgress({ panelId, status: 'generating', progress: 0, message: 'Preparing inpaint…' });

    try {
      const imageData = await comfyUIService.inpaintPanel(
        panel.generatedImageData,
        maskData,
        editDescription,
        (prog, msg) => setProgress({ panelId, status: 'generating', progress: prog, message: msg }),
        panel.characters
      );

      let savedPath: string | null = null;
      if (window.electronAPI) {
        const b64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
        const result = await window.electronAPI.saveImage(b64, `panel_${panelId}_${Date.now()}.png`);
        if (result.success) savedPath = result.filePath ?? null;
      }

      // Push current image into editHistory (session undo, max 10)
      const currentHistory = panel.editHistory ?? [];
      const newHistory = [...currentHistory, panel.generatedImageData].slice(-10);

      // Push current image into persistent revision history (max 20)
      const inpaintRevision: PanelRevision = {
        id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageData: panel.generatedImageData,
        prompt: editDescription,
        timestamp: Date.now(),
        label: `Edit: ${editDescription}`,
      };
      const currentRevisions = panel.revisions ?? [];
      const newRevisions = [...currentRevisions, inpaintRevision].slice(-20);

      updatePanel(panelId, {
        generatedImageData: imageData,
        generatedImagePath: savedPath ?? panel.generatedImagePath,
        editHistory: newHistory,
        revisions: newRevisions,
      });

      setProgress({ panelId, status: 'complete', progress: 100, message: 'Edit applied' });
      setTimeout(() => setProgress(null), 2000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const isProUser = licenseService.isPro() || licenseService.isStudio();
      const message = !isProUser
        ? 'Local inpainting requires ComfyUI to be running. Upgrade to Pro for cloud inpainting — no setup needed.'
        : 'Edit failed. Please try again.';
      setProgress({ panelId, status: 'error', progress: 0, message, error: isProUser ? msg : undefined });
    }
  }

  async function handleAnimatePanel(panelId: string, motionDescription: string, motionEngine: 'seedance' | 'veo' = 'seedance') {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel?.generatedImageData) return;

    updatePanel(panelId, { motionDescription });
    setProgress({ panelId, status: 'animating', progress: 0, message: 'Refining motion prompt...' });

    try {
      let motionPrompt = motionDescription;
      if (serviceStatus.ollama === 'connected') {
        motionPrompt = await ollamaService.refineMotionPrompt(motionDescription);
      }

      const isProUser = licenseService.isPro() || licenseService.isStudio();

      let base64Video: string;

      if (isProUser) {
        // Pro/Studio: Seedance or Veo cloud — no local Wan fallback
        const engineLabel = motionEngine === 'veo' ? 'Veo 3.1' : 'Seedance';
        setProgress({ panelId, status: 'animating', progress: 5, message: `Sending to ${engineLabel}…` });
        if (motionEngine === 'veo') {
          base64Video = await comfyUIService.animatePanelVeo(
            panel.generatedImageData,
            motionPrompt,
            (prog, msg) => setProgress({ panelId, status: 'animating', progress: prog, message: msg })
          );
        } else {
          base64Video = await comfyUIService.animatePanelSeedance(
            panel.generatedImageData,
            motionPrompt,
            (prog, msg) => setProgress({ panelId, status: 'animating', progress: prog, message: msg })
          );
        }
      } else {
        // Community: local Wan I2V only
        setProgress({ panelId, status: 'animating', progress: 5, message: 'Generating motion clip...' });
        base64Video = await comfyUIService.animatePanel(
          panel.generatedImageData,
          motionPrompt,
          (prog, msg) => setProgress({ panelId, status: 'animating', progress: prog, message: msg })
        );
      }

      // Save to disk when running in Electron
      let clipPath: string | null = null;
      if (window.electronAPI?.saveVideo) {
        const isMP4 = base64Video.startsWith('data:video/mp4');
        const ext = isMP4 ? 'mp4' : 'webp';
        const b64 = base64Video.replace(/^data:[^;]+;base64,/, '');
        const result = await window.electronAPI.saveVideo(b64, `clip_${panelId}_${Date.now()}.${ext}`);
        if (result.success) clipPath = result.filePath ?? null;
      }

      updatePanel(panelId, { motionClipData: base64Video, motionClipPath: clipPath });
      telemetryService.track('motion_generated');
      setProgress({ panelId, status: 'complete', progress: 100, message: 'Motion clip ready' });
      setTimeout(() => setProgress(null), 2000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const isProUser = licenseService.isPro() || licenseService.isStudio();
      if (isProUser) {
        // Surface the real cloud error — no local fallback for Pro/Studio
        setProgress({ panelId, status: 'error', progress: 0, message: 'Cloud animation failed', error: `${msg} Please try again.` });
        return;
      }
      if (error instanceof Error && error.message === 'WAN_MODEL_UNAVAILABLE') {
        setProgress({
          panelId,
          status: 'error',
          progress: 0,
          message: 'Motion generation unavailable',
          error: 'Motion generation requires a powerful GPU (24GB+ VRAM).',
          errorLink: { label: 'Upgrade to Pro →', url: 'https://imagginary.com/pro' },
        });
        return;
      }
      // Community user — hide technical Wan errors behind an upgrade prompt
      if (msg.includes('Wan 2.2')) {
        setProgress({
          panelId,
          status: 'error',
          progress: 0,
          message: 'Motion generation requires Pro',
          error: 'Upgrade to Pro to generate motion clips via Kling cloud — no local GPU required.',
          errorLink: { label: 'Upgrade to Pro →', url: 'https://imagginary.com/pro' },
        });
        return;
      }
      setProgress({ panelId, status: 'error', progress: 0, message: 'Motion generation failed', error: `${msg} Please try again.` });
    }
  }

  function handleClearMotion(panelId: string) {
    updatePanel(panelId, { motionClipData: null, motionClipPath: null, motionDescription: '' });
  }

  async function handleRemoveVoice(panelId: string) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (panel?.voicePath) {
      await window.electronAPI?.deleteFile?.(panel.voicePath).catch(() => {});
    }
    updatePanel(panelId, { voicePath: null, voiceCharacterId: null });
  }

  async function handleGeneratePoseAnimation(params: {
    poseTemplateIds: string[];
    description: string;
    framesPerSegment: number;
  }) {
    if (!activePanelId) return;
    const panel = project.panels.find((p) => p.id === activePanelId);
    if (!panel?.generatedImageData) return;

    if (!licenseService.hasCredits(CREDIT_COSTS.poseEngine)) {
      setProgress({
        panelId: activePanelId,
        status: 'error',
        progress: 0,
        message: `Insufficient credits for Pose Engine (need ${CREDIT_COSTS.poseEngine}). Add credits to continue.`,
      });
      return;
    }

    setIsPoseGenerating(true);
    setProgress({
      panelId: activePanelId,
      status: 'animating',
      progress: 0,
      message: 'Building pose sequence…',
    });

    try {
      const result = await poseEngineService.generatePoseAnimation({
        imageData: panel.generatedImageData,
        description: params.description,
        poseTemplateIds: params.poseTemplateIds,
        framesPerSegment: params.framesPerSegment,
        onProgress: (pct, msg) =>
          setProgress({ panelId: activePanelId, status: 'animating', progress: pct, message: msg }),
      });

      // Save posed image to disk
      let savedPath: string | null = null;
      if (window.electronAPI?.saveImage) {
        const b64 = result.imageData.replace(/^data:[^;]+;base64,/, '');
        const saved = await window.electronAPI.saveImage(b64, `pose_${activePanelId}_${Date.now()}.png`);
        if (saved.success) savedPath = saved.filePath ?? null;
      }

      // Push current image into history for undo
      const currentHistory = panel.editHistory ?? [];
      const newHistory = [...currentHistory, panel.generatedImageData].slice(-10);
      const newRevision = {
        id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageData: panel.generatedImageData,
        prompt: panel.prompt ?? '',
        timestamp: Date.now(),
        label: 'Before pose',
      };
      const newRevisions = [...(panel.revisions ?? []), newRevision].slice(-20);

      updatePanel(activePanelId, {
        generatedImageData: result.imageData,
        generatedImagePath: savedPath ?? panel.generatedImagePath,
        editHistory: newHistory,
        revisions: newRevisions,
      });

      await licenseService.spendCredits(CREDIT_COSTS.poseEngine);
      setProgress({
        panelId: activePanelId,
        status: 'complete',
        progress: 100,
        message: 'Pose applied',
      });
      setTimeout(() => setProgress(null), 2000);
      setShowPoseEditor(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg === 'CONTROLNET_NOT_INSTALLED') {
        // PoseEditor handles this — re-throw so it can show download UI
        setIsPoseGenerating(false);
        throw error;
      }
      setProgress({
        panelId: activePanelId,
        status: 'error',
        progress: 0,
        message: 'Pose generation failed',
        error: msg,
      });
    } finally {
      setIsPoseGenerating(false);
    }
  }

  async function handleApplyMotionClip({ clipId, videoData }: { clipId: string; videoData: string }) {
    if (!activePanelId) return;
    let clipPath: string | null = null;
    if (window.electronAPI?.saveVideo) {
      const b64 = videoData.replace(/^data:[^;]+;base64,/, '');
      const saved = await window.electronAPI.saveVideo(
        b64,
        `motion_${clipId}_${Date.now()}.mp4`
      );
      if (saved.success) clipPath = saved.filePath ?? null;
    }
    updatePanel(activePanelId, {
      motionClipData: videoData,
      motionClipPath: clipPath,
    });
    await licenseService.spendCredits(CREDIT_COSTS.motionClip);
    setShowMotionLibrary(false);
  }

  async function handleVideoTransferComplete(videoData: string, clipPath: string | null) {
    if (!activePanelId) return;
    if (!videoData || typeof videoData !== 'string') {
      console.error('[VideoTransfer] received non-string videoData:', typeof videoData);
      return;
    }
    let savedPath = clipPath;
    if (!savedPath && window.electronAPI?.saveVideo) {
      const isMP4 = videoData.startsWith('data:video/mp4');
      const ext = isMP4 ? 'mp4' : 'webp';
      const b64 = videoData.replace(/^data:[^;]+;base64,/, '');
      const saved = await window.electronAPI.saveVideo(
        b64,
        `transfer_${activePanelId}_${Date.now()}.${ext}`
      );
      if (saved.success) savedPath = saved.filePath ?? null;
    }
    updatePanel(activePanelId, {
      motionClipData: videoData,
      motionClipPath: savedPath,
    });
    setShowVideoTransfer(false);
  }

  async function handleVoiceComplete(wavPath: string, characterId: string | null) {
    if (!activePanelId) return;
    const panel = project.panels.find((p) => p.id === activePanelId);
    if (panel?.voicePath && panel.voicePath !== wavPath) {
      await window.electronAPI?.deleteFile?.(panel.voicePath).catch(() => {});
    }
    updatePanel(activePanelId, {
      voicePath: wavPath,
      voiceCharacterId: characterId,
    });
    telemetryService.track('voice_generated');
    setShowVoiceStudio(false);
  }

  function handleLipSyncComplete(videoUrl: string) {
    if (!activePanelId) return;
    updatePanel(activePanelId, { lipSyncPath: videoUrl });
  }

  function handleUndoEdit(panelId: string) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel?.editHistory?.length) return;
    const history = [...panel.editHistory];
    const previous = history.pop()!;
    updatePanel(panelId, {
      generatedImageData: previous,
      editHistory: history,
    });
  }

  function handleRestoreRevision(panelId: string, revision: PanelRevision) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel) return;
    const currentRevisions = panel.revisions ?? [];
    // Save current image as a revision before restoring, so the restore is reversible
    const beforeRestoreRevision: PanelRevision | undefined = panel.generatedImageData
      ? {
          id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          imageData: panel.generatedImageData,
          prompt: panel.shotDescription,
          timestamp: Date.now(),
          label: 'Before restore',
        }
      : undefined;
    const remaining = currentRevisions.filter((r) => r.id !== revision.id);
    const newRevisions = beforeRestoreRevision
      ? [...remaining, beforeRestoreRevision].slice(-20)
      : remaining;
    updatePanel(panelId, {
      generatedImageData: revision.imageData,
      revisions: newRevisions,
    });
  }

  async function handleExportPanel() {
    if (!activePanel?.generatedImageData || !window.electronAPI) return;
    const result = await window.electronAPI.showSaveDialog({
      title: 'Export Panel',
      defaultPath: `panel_${(activePanel.order + 1).toString().padStart(2, '0')}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return;
    const b64 = activePanel.generatedImageData.replace(/^data:image\/[^;]+;base64,/, '');
    await window.electronAPI.saveImage(b64, result.filePath);
  }

  async function handleExportPanelWithVoice() {
    if (!activePanel?.generatedImagePath || !activePanel?.voicePath || !window.electronAPI) return;
    const padded = (activePanel.order + 1).toString().padStart(2, '0');
    const result = await window.electronAPI.showSaveDialog({
      title: 'Export Panel with Voice',
      defaultPath: `panel_${padded}_with_voice.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return;
    const exportResult = await window.electronAPI.exportPanelWithVoice({
      imagePath: activePanel.generatedImagePath,
      voicePath: activePanel.voicePath,
      outputPath: result.filePath,
    });
    if (!exportResult?.success) {
      setExportError(exportResult?.error ?? 'Export with voice failed');
      setTimeout(() => setExportError(null), 5000);
    }
  }

  async function handleExportPDF() {
    const result = await productionExporter.exportPDF(project.panels, project.title);
    telemetryService.track('pdf_exported');
    if (result.success && result.droppedCount && result.droppedCount > 0) {
      const n = result.droppedCount;
      setExportError(`Note: ${n} panel${n > 1 ? 's were' : ' was'} excluded from the PDF — generate images for all panels first.`);
      setTimeout(() => setExportError(null), 6000);
    }
  }

  async function handleExportXML() {
    const result = await productionExporter.exportFCPXML(project.panels, project.title);
    telemetryService.track('fcpxml_exported');
    if (result.success && result.droppedCount && result.droppedCount > 0) {
      const n = result.droppedCount;
      setExportError(`Note: ${n} panel${n > 1 ? 's were' : ' was'} excluded from the XML — save your project first to include all panels.`);
      setTimeout(() => setExportError(null), 6000);
    }
  }

  useEffect(() => {
    if (activePanel) setShotInput(activePanel.shotDescription ?? '');
    else setShotInput('');
  }, [activePanelId]);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {showWelcome && (
        <WelcomeFlow
          serviceStatus={serviceStatus}
          servicesAutoStarted={servicesAutoStarted}
          onRefreshServices={() => {
            setServiceStatus({ comfyui: 'checking', ollama: 'checking' });
            checkServicesRef.current?.();
          }}
          onComplete={handleWelcomeComplete}
          isDismissible={welcomeDismissible}
          onDismiss={() => { setShowWelcome(false); setWelcomeDismissible(false); }}
        />
      )}
      <TitleBar
        projectTitle={project.title}
        serviceStatus={serviceStatus}
        onNewProject={handleNewProject}
        onRenameProject={(title) => setProject((prev) => ({ ...prev, title, updatedAt: Date.now() }))}
        onSaveProject={handleSave}
        onLoadProject={handleLoad}
        onGenerateAnimatic={handleGenerateAnimatic}
        onExportMotionComic={handleExportMotionComic}
        onOpenScriptReader={() => setShowScriptReader(true)}
        onSetup={() => { setShowWelcome(true); setWelcomeDismissible(true); }}
        onOpenSettings={() => setShowSettings(true)}
        onExportPDF={handleExportPDF}
        onExportXML={handleExportXML}
        isSaving={isSaving}
        isExporting={isExporting}
        exportProgress={exportProgress}
        isPro={licenseService.isPro() || licenseService.isStudio()}
        isStudio={licenseService.isStudio()}
        currentTier={currentTier}
        tierAccent={tierAccent}
        onActivateLicense={() => setShowActivateLicense(true)}
        onUpgradeToStudio={() => licenseService.openCheckout('studio')}
        isExportingMotionComic={isExportingMotionComic}
        motionComicProgress={motionComicProgress}
        hasMotionClips={hasMotionClips}
        isSharedSession={isSharedSession}
        onStartSharedSession={startSharedSession}
        onCopyInviteLink={handleCopyInviteLink}
        sharedStudioConfigured={sharedStudioService.isConfigured()}
      />

      {isSharedSession && (
        <SharedStudioPanel
          projectId={project.id}
          users={sessionUsers}
          connectionStatus={sharedStudioConnectionStatus}
          onInvite={() => setShowShareModal(true)}
          onLeave={handleLeaveSharedSession}
        />
      )}

      {showShareModal && (
        <ShareProjectModal
          projectId={project.id}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {showSharedStudioOnboarding && (
        <SharedStudioOnboarding
          onClose={() => setShowSharedStudioOnboarding(false)}
          onConfigured={async () => {
            setShowSharedStudioOnboarding(false);
            const joined = await sharedStudioService.joinProject(project.id, handleSharedStudioEventRef.current, () => projectRef.current);
            if (joined) setIsSharedSession(true);
          }}
        />
      )}

      {showScriptReader && (
        <ScriptReader
          characters={project.characters}
          isOllamaConnected={serviceStatus.ollama === 'connected'}
          onGenerate={handleScriptGenerate}
          onClose={() => setShowScriptReader(false)}
        />
      )}

      {showStylePicker && (
        <StylePicker
          currentStyle={project.style}
          currentAspectRatioId={project.aspectRatioId}
          onApply={(style) => setProject((prev) => ({ ...prev, style, updatedAt: Date.now() }))}
          onApplyAspectRatio={(id) => setProject((prev) => ({ ...prev, aspectRatioId: id, updatedAt: Date.now() }))}
          onClose={() => setShowStylePicker(false)}
          isStudio={licenseService.isStudio()}
          onOpenLoraTrainer={() => { setShowStylePicker(false); setShowLoraTrainer(true); }}
          customStylesKey={customStylesLoaded}
        />
      )}

      {showLoraTrainer && licenseService.isStudio() && (
        <LoRATrainer
          onClose={() => setShowLoraTrainer(false)}
          onStyleCreated={(style) => {
            customStyleService.updateCustomStyleStatus(style.id, style);
            setCustomStylesLoaded(prev => !prev);
          }}
          isStudio={licenseService.isStudio()}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-60 shrink-0 flex flex-col bg-gray-950 border-r border-gray-800 min-h-0">
          <div className="px-3 py-2.5 border-b border-gray-800">
            <input
              type="text"
              value={project.title}
              onChange={(e) => setProject((prev) => ({ ...prev, title: e.target.value, updatedAt: Date.now() }))}
              className="w-full bg-transparent text-sm font-semibold text-gray-200 outline-none focus:text-white truncate"
            />
          </div>

          {/* Style + Aspect Ratio indicator */}
          <div className="px-3 py-1.5 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg className="w-3 h-3 text-gray-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
              </svg>
              <div className="min-w-0">
                <div className="text-[11px] text-gray-400 truncate">
                  {activePanel?.styleProfileId
                    ? (customStyleService.getStyleById(activePanel.styleProfileId)?.name ?? project.style.name)
                    : project.style.name}
                </div>
                <div className="text-[10px] text-gray-600">
                  {safeGetAspectRatio(project.aspectRatioId ?? DEFAULT_ASPECT_RATIO_ID, licenseService.isStudio()).label}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowStylePicker(true)}
              className="text-[10px] text-imagginary-600 hover:text-imagginary-400 transition-colors shrink-0 ml-1"
            >
              Change
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <PanelList
              panels={project.panels}
              activePanelId={activePanelId}
              onSelectPanel={setActivePanelId}
              onAddPanel={addPanel}
              onDeletePanel={deletePanel}
              onReorderPanels={reorderPanels}
              tierAccent={tierAccent}
            />
          </div>

          <div className="border-t border-gray-800 shrink-0">
            <CharacterLibrary
              characters={project.characters}
              onCreateCharacter={handleCreateCharacter}
              onDeleteCharacter={deleteCharacter}
              generationProgress={charProgress}
            />
          </div>
        </div>

        {/* Center */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {modelMissing && (
            <div className="mx-3 mt-2 shrink-0 bg-amber-900/30 border border-amber-700 rounded-lg p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-300">
                {modelDownloading
                  ? `Downloading storyboard model… ${Number(modelDownloadPct).toFixed(1)}%`
                  : 'Storyboard model not found. Download required to generate panels.'}
              </p>
              {!modelDownloading && (
                <button
                  onClick={async () => {
                    if (!window.electronAPI) return;
                    setModelDownloading(true);
                    setModelDownloadPct(0);
                    const cleanup = window.electronAPI.onDownloadModelProgress((data) => {
                      setModelDownloadPct(data.pct);
                    });
                    const result = await window.electronAPI.downloadModels();
                    cleanup();
                    setModelDownloading(false);
                    if (result.success) setModelMissing(false);
                  }}
                  className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 rounded shrink-0"
                >
                  Download (2GB)
                </button>
              )}
              {modelDownloading && (
                <div className="w-32 bg-amber-900 rounded-full h-1.5 shrink-0">
                  <div
                    className="bg-amber-400 h-1.5 rounded-full transition-all"
                    style={{ width: `${modelDownloadPct}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {(licenseService.isPro() || licenseService.isStudio()) && !proModelInstalled && !modelMissing && (
            <div className="mx-3 mt-2 shrink-0 bg-amber-900/30 border border-amber-700 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-amber-300">
                  ✦ Optional: RealVisXL V4.0 for local generation (offline / no credits)
                </p>
                {!proModelDownloading ? (
                  <button
                    onClick={async () => {
                      if (!window.electronAPI) return;
                      setProModelDownloading(true);
                      setProModelPct(0);
                      const cleanup = window.electronAPI.onProModelProgress((data) => {
                        setProModelPct(data.pct);
                      });
                      const result = await window.electronAPI.downloadProModel();
                      cleanup();
                      setProModelDownloading(false);
                      if (result.success) setProModelInstalled(true);
                    }}
                    className="text-xs bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 rounded shrink-0"
                  >
                    Download (6.5GB)
                  </button>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-32 bg-amber-900 rounded-full h-1.5">
                      <div
                        className="bg-amber-400 h-1.5 rounded-full transition-all"
                        style={{ width: `${proModelPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-amber-400">{Number(proModelPct).toFixed(1)}%</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">Cloud generation via FLUX.1 is already active — this is for offline use only.</p>
            </div>
          )}
          <PanelViewer
            panel={activePanel}
            progress={progress}
            effectiveAspectRatio={effectiveAspectRatio}
            onInpaintEdit={handleInpaintEdit}
            onUndoEdit={handleUndoEdit}
            onAnimatePanel={handleAnimatePanel}
            onClearMotion={handleClearMotion}
            onRemoveVoice={handleRemoveVoice}
            onRestoreRevision={handleRestoreRevision}
            onUpgrade={() => setShowActivateLicense(true)}
            onOpenPoseEditor={() => setShowPoseEditor(true)}
            onOpenMotionLibrary={() => setShowMotionLibrary(true)}
            onOpenVideoTransfer={() => setShowVideoTransfer(true)}
            onOpenVoiceStudio={() => {
              if (activePanelId && isPanelGenerating(activePanelId)) return;
              setShowVoiceStudio(true);
            }}
            onClearError={() => setProgress(null)}
            onCancelAnimate={() => { window.electronAPI?.cancelFalVideo?.(); window.electronAPI?.cancelFalKling?.(); setProgress(null); }}
            onCancelInpaint={() => { window.electronAPI?.interruptComfyUI?.(); setProgress(null); }}
            comfyuiConnected={serviceStatus.comfyui === 'connected'}
            wanModelAvailable={wanModelAvailable}
            wanModelWarning={wanModelWarning}
            isPro={licenseService.isPro() || licenseService.isStudio()}
            tierAccent={tierAccent}
            onCursorMove={isSharedSession ? handleCursorMove : undefined}
            collaboratorCursors={isSharedSession ? collaboratorCursors : undefined}
          />
          <ShotInput
            value={shotInput}
            onChange={setShotInput}
            onGenerate={handleGenerate}
            onOptionsChange={setShotConstraints}
            isGenerating={activePanelId ? isPanelGenerating(activePanelId) : false}
            serviceStatus={serviceStatus}
            disabled={false}
            estimatedSeconds={(licenseService.isPro() || licenseService.isStudio()) ? null : estimatedGenerationSeconds}
            onUpgradeClick={() => setShowActivateLicense(true)}
          />
        </div>

        {/* Right sidebar */}
        <div className="shrink-0 border-l border-gray-800 overflow-hidden" style={{ width: '280px' }}>
          <RightSidebar
            panel={activePanel}
            characters={project.characters}
            projectAspectRatioId={project.aspectRatioId}
            onUpdatePanel={(updates) => activePanelId && updatePanel(activePanelId, updates)}
            onUpdateStructuredPrompt={handleUpdateStructuredPrompt}
            onGenerate={handleRegenerate}
            onRegenerate={handleRegenerate}
            onExportPanel={handleExportPanel}
            onExportPanelWithVoice={activePanel?.voicePath && activePanel?.generatedImagePath ? handleExportPanelWithVoice : undefined}
            isGenerating={activePanelId ? isPanelGenerating(activePanelId) : false}
            activeStyleProfile={project.style}
          />
        </div>
      </div>

      {/* Phase 6B — Pose Editor modal */}
      {showPoseEditor && activePanel && (
        <PoseEditor
          panel={activePanel}
          isPro={licenseService.isPro() || licenseService.isStudio()}
          isGenerating={isPoseGenerating}
          onGenerate={handleGeneratePoseAnimation}
          onClose={() => setShowPoseEditor(false)}
        />
      )}

      {/* Phase 6C — Motion Library modal */}
      {showMotionLibrary && activePanel && (
        <MotionLibrary
          panel={activePanel}
          isPro={licenseService.isPro() || licenseService.isStudio()}
          comfyuiConnected={serviceStatus.comfyui === 'connected'}
          onApply={handleApplyMotionClip}
          onClose={() => setShowMotionLibrary(false)}
          onUpgrade={() => setShowActivateLicense(true)}
        />
      )}

      {/* Phase 6E — Video Transfer modal */}
      {showVideoTransfer && activePanel && (
        <VideoTransfer
          panel={activePanel}
          characters={project.characters}
          isPro={licenseService.isPro() || licenseService.isStudio()}
          onComplete={handleVideoTransferComplete}
          onClose={() => setShowVideoTransfer(false)}
          onUpgrade={() => setShowActivateLicense(true)}
        />
      )}

      {/* Phase 15 — Voice Studio modal */}
      {showVoiceStudio && activePanel && (
        <VoiceStudio
          panel={activePanel}
          characters={project.characters}
          isPro={licenseService.isPro() || licenseService.isStudio()}
          isStudio={licenseService.isStudio()}
          isVoiceGenerating={isVoiceGenerating(activePanel.id)}
          onComplete={handleVoiceComplete}
          onLipSyncComplete={handleLipSyncComplete}
          onOpenSettings={() => { setShowVoiceStudio(false); setShowSettings(true); }}
          onClose={() => setShowVoiceStudio(false)}
          onVoiceGenerationStart={(panelId) => setVoiceGenerating(panelId, 'generating')}
          onVoiceGenerationEnd={(panelId) => setVoiceGenerating(panelId, 'idle')}
        />
      )}

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal
          isPro={licenseService.isPro() || licenseService.isStudio()}
          isStudio={licenseService.isStudio()}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* License activation modal */}
      {showActivateLicense && (
        <ActivateLicense
          currentLicense={license}
          onLicenseChange={() => {
            setLicense(licenseService.getLicense());
            telemetryService.track('license_activated', { tier: licenseService.getTier() });
          }}
          onClose={() => setShowActivateLicense(false)}
        />
      )}

      {/* First cloud generation toast — auto-dismisses after 4s */}
      {cloudToast && (
        <div className="fixed bottom-4 right-4 bg-gray-900/95 border border-amber-700/60 text-amber-300 text-xs px-4 py-2 rounded-lg z-50 max-w-sm">
          {cloudToast}
        </div>
      )}

      {/* Export error toast — auto-dismisses after 5s */}
      {exportError && (
        <div className="fixed bottom-4 right-4 bg-red-900/90 border border-red-700 text-red-200 text-xs px-4 py-2 rounded-lg z-50 max-w-sm">
          {exportError}
        </div>
      )}

      {/* Project load error toast */}
      {loadError && (
        <div
          className="fixed bottom-4 right-4 bg-red-900/90 border border-red-700 text-red-200 text-xs px-4 py-2 rounded-lg z-50 max-w-sm cursor-pointer"
          onClick={() => setLoadError(null)}
        >
          {loadError}
        </div>
      )}
    </div>
  );
}
