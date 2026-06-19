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
import { sharedStudioService, SharedStudioEvent } from './services/SharedStudioService';
import ShotInput, { ShotConstraints } from './components/ShotInput';
import CharacterLibrary from './components/CharacterLibrary';
import RightSidebar from './components/RightSidebar';
import { licenseService, CREDIT_COSTS } from './services/LicenseService';
import { telemetryService } from './services/TelemetryService';
import { settingsService } from './services/SettingsService';
import { ollamaService } from './services/OllamaService';
import { comfyUIService } from './services/ComfyUIService';
import { characterLibraryService } from './services/CharacterLibraryService';
import { animaticExporter } from './services/AnimaticExporter';
import { productionExporter } from './services/ProductionExporter';
import { motionComicExporter } from './services/MotionComicExporter';
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
import { getAspectRatio, DEFAULT_ASPECT_RATIO_ID } from './data/AspectRatios';

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
  saveProject: (data: unknown, filePath: string) => Promise<{ success: boolean; error?: string }>;
  loadProject: (filePath: string) => Promise<{ success: boolean; data?: Project; error?: string }>;
  showSaveDialog: (opts: object) => Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog: (opts: object) => Promise<{ canceled: boolean; filePaths?: string[] }>;
  saveImage: (base64: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  saveVideo: (base64: string, fileName: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  getAppDataPath: () => Promise<string>;
  openFolder: (path: string) => void;
  exportPDF: (base64Data: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  exportFCPXML: (xmlString: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  downloadModels: () => Promise<{ success: boolean; cached?: boolean; error?: string }>;
  onDownloadModelProgress: (cb: (data: { pct: number; downloaded: number; total: number }) => void) => () => void;
  downloadProModel: () => Promise<{ success: boolean; cached?: boolean; error?: string }>;
  onProModelProgress: (cb: (data: { pct: number; downloaded: number; total: number }) => void) => () => void;
  onJoinSharedProject: (cb: (data: { projectId: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

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
  // Phase 6B — Pose Engine
  const [showPoseEditor, setShowPoseEditor] = useState(false);
  const [isPoseGenerating, setIsPoseGenerating] = useState(false);
  // Phase 6C — Motion Library
  const [showMotionLibrary, setShowMotionLibrary] = useState(false);
  // Phase 6E — Video Transfer
  const [showVideoTransfer, setShowVideoTransfer] = useState(false);
  // Phase 15 — Voice Studio
  const [showVoiceStudio, setShowVoiceStudio] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('imagginary_onboarded'));
  const [showScriptReader, setShowScriptReader] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);
  // Phase 14 — true when the main process auto-started Ollama + ComfyUI successfully
  const [servicesAutoStarted, setServicesAutoStarted] = useState(false);
  // License
  const [license, setLicense] = useState<License | null>(null);
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

  // ── Settings + License load ───────────────────────────────────────────────────
  useEffect(() => {
    settingsService.load();
    licenseService.load().then(() => setLicense(licenseService.getLicense()));
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
  const isGenerating = progress !== null && progress.status !== 'complete' && progress.status !== 'error';
  const effectiveAspectRatio = getAspectRatio(
    activePanel?.aspectRatioId || project.aspectRatioId || DEFAULT_ASPECT_RATIO_ID
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
  ) {
    if (!description.trim()) return;
    if (serviceStatus.ollama !== 'connected') return;

    setProgress({ panelId, status: 'parsing', progress: 0, message: 'Parsing shot description…' });

    try {
      // Constraints priority: overrideConstraints (from ShotInput dropdowns) > panel pre-set values
      const panel = project.panels.find((p) => p.id === panelId);
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

      // Resolve effective aspect ratio: panel override → project default → global default
      const effectiveAspectRatio = getAspectRatio(
        panel?.aspectRatioId || project.aspectRatioId || DEFAULT_ASPECT_RATIO_ID
      );

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
          revisions: [...currentRevisions, newRevision].slice(-20),
        });
      } else {
        updatePanel(panelId, { generatedImageData: imageData, generatedImagePath: savedPath });
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

      if (isOllamaError && (window as any).electronAPI?.getSystemMemory) {
        try {
          const { freeMem } = await (window as any).electronAPI.getSystemMemory() as { totalMem: number; freeMem: number };
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

    // Kick off first panel generation immediately after overlay closes
    setTimeout(() => {
      const panel = createEmptyPanel(0);
      setProject((prev) => ({ ...prev, panels: [panel], updatedAt: Date.now() }));
      setActivePanelId(panel.id);
      generate(panel.id, firstShot);
    }, 50);
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
        setProject((prev) => ({
          ...event.project,
          panels: event.project.panels.map((incomingPanel) => {
            const localPanel = prev.panels.find((p) => p.id === incomingPanel.id);
            // Keep local panel if it's currently being generated
            if (localPanel && progress?.panelId === localPanel.id) return localPanel;
            return incomingPanel;
          }),
        }));
        break;
      case 'user_joined':
        setSessionUsers((prev) => [
          ...prev.filter((u) => u.userId !== event.userId),
          { userId: event.userId, userName: event.userName },
        ]);
        break;
      case 'user_left':
        setSessionUsers((prev) => prev.filter((u) => u.userId !== event.userId));
        break;
    }
  }

  async function startSharedSession() {
    if (!licenseService.isStudio()) return;
    if (!sharedStudioService.isConfigured()) {
      setShowSettings(true);
      return;
    }
    const joined = await sharedStudioService.joinProject(project.id, handleSharedStudioEvent);
    if (joined) setIsSharedSession(true);
  }

  async function handleLeaveSharedSession() {
    await sharedStudioService.leaveProject();
    setIsSharedSession(false);
    setSessionUsers([]);
  }

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
    if (!window.electronAPI?.onJoinSharedProject) return;
    const cleanup = window.electronAPI.onJoinSharedProject(({ projectId }: { projectId: string }) => {
      if (!licenseService.isStudio()) return;
      if (!sharedStudioService.isConfigured()) { setShowSettings(true); return; }
      sharedStudioService.joinProject(projectId, handleSharedStudioEvent).then((ok) => {
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
        // Pass characterIds directly to avoid stale closure over project state
        await generate(newPanels[i].id, shots[i].shotDescription, shots[i].assignedCharacterIds);
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
      setProgress({ panelId, status: 'error', progress: 0, message: 'Inpaint failed', error: msg });
    }
  }

  async function handleAnimatePanel(panelId: string, motionDescription: string) {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel?.generatedImageData) return;

    updatePanel(panelId, { motionDescription });
    setProgress({ panelId, status: 'animating', progress: 0, message: 'Refining motion prompt...' });

    try {
      let motionPrompt = motionDescription;
      if (serviceStatus.ollama === 'connected') {
        motionPrompt = await ollamaService.refineMotionPrompt(motionDescription);
      }

      // Try Kling cloud first (Pro + Fal.ai key + sufficient credits)
      const falApiKey = settingsService.getKey('falApiKey') || '';
      const useCloud = licenseService.isPro() && !!falApiKey && licenseService.hasCredits(CREDIT_COSTS.motionClip);

      let base64Video: string | null = null;

      if (useCloud) {
        setProgress({ panelId, status: 'animating', progress: 5, message: 'Sending to Kling…' });
        base64Video = await comfyUIService.animatePanelCloud(
          panel.generatedImageData,
          motionPrompt,
          (prog, msg) => setProgress({ panelId, status: 'animating', progress: prog, message: msg })
        );
      }

      if (!base64Video) {
        // Fall back to local Wan I2V
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
      if (error instanceof Error && error.message === 'WAN_MODEL_UNAVAILABLE') {
        setProgress({
          panelId,
          status: 'error',
          progress: 0,
          message: 'Motion generation unavailable',
          error: 'Motion generation requires a powerful GPU (24GB+ VRAM). Pro users can use Kling cloud motion instead.',
          errorLink: licenseService.isPro() ? undefined : { label: 'Upgrade to Pro →', url: 'https://imagginary.com/pro' },
        });
        return;
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setProgress({ panelId, status: 'error', progress: 0, message: 'Motion generation failed', error: msg });
    }
  }

  function handleClearMotion(panelId: string) {
    updatePanel(panelId, { motionClipData: null, motionClipPath: null, motionDescription: '' });
  }

  async function handleGeneratePoseAnimation(params: {
    poseTemplateIds: string[];
    description: string;
    framesPerSegment: number;
  }) {
    if (!activePanelId) return;
    const panel = project.panels.find((p) => p.id === activePanelId);
    if (!panel?.generatedImageData) return;

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

      // Persist the video to disk
      let clipPath: string | null = result.videoPath;
      if (window.electronAPI?.saveVideo) {
        const isMP4 = result.videoData.startsWith('data:video/mp4');
        const ext = isMP4 ? 'mp4' : 'webp';
        const b64 = result.videoData.replace(/^data:[^;]+;base64,/, '');
        const saved = await window.electronAPI.saveVideo(
          b64,
          `pose_${activePanelId}_${Date.now()}.${ext}`
        );
        if (saved.success) clipPath = saved.filePath ?? null;
      }

      updatePanel(activePanelId, {
        poseClipData: result.videoData,
        poseClipPath: clipPath,
      });

      setProgress({
        panelId: activePanelId,
        status: 'complete',
        progress: 100,
        message: 'Pose animation ready',
      });
      setTimeout(() => setProgress(null), 2000);
      setShowPoseEditor(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
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
    setShowMotionLibrary(false);
  }

  async function handleVideoTransferComplete(videoData: string, clipPath: string | null) {
    if (!activePanelId) return;
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

  function handleVoiceComplete(wavPath: string, characterId: string | null) {
    if (!activePanelId) return;
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

  async function handleExportPDF() {
    await productionExporter.exportPDF(project.panels, project.title);
    telemetryService.track('pdf_exported');
  }

  async function handleExportXML() {
    await productionExporter.exportFCPXML(project.panels, project.title);
    telemetryService.track('fcpxml_exported');
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
        onSetup={() => setShowWelcome(true)}
        onOpenSettings={() => setShowSettings(true)}
        onExportPDF={handleExportPDF}
        onExportXML={handleExportXML}
        isSaving={isSaving}
        isExporting={isExporting}
        exportProgress={exportProgress}
        isStudio={licenseService.isStudio()}
        onActivateLicense={() => setShowActivateLicense(true)}
        isExportingMotionComic={isExportingMotionComic}
        motionComicProgress={motionComicProgress}
        hasMotionClips={hasMotionClips}
        isSharedSession={isSharedSession}
        onStartSharedSession={startSharedSession}
      />

      {isSharedSession && (
        <SharedStudioPanel
          projectId={project.id}
          users={sessionUsers}
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
                <div className="text-[11px] text-gray-400 truncate">{project.style.name}</div>
                <div className="text-[10px] text-gray-600">
                  {getAspectRatio(project.aspectRatioId ?? DEFAULT_ASPECT_RATIO_ID).label}
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
            />
          </div>

          <div className="border-t border-gray-800 shrink-0">
            <CharacterLibrary
              characters={project.characters}
              onCreateCharacter={handleCreateCharacter}
              onDeleteCharacter={deleteCharacter}
              generationProgress={charProgress}
              isPro={licenseService.isPro()}
            />
          </div>
        </div>

        {/* Center */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {modelMissing && (
            <div className="mx-3 mt-2 shrink-0 bg-amber-900/30 border border-amber-700 rounded-lg p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-300">
                {modelDownloading
                  ? `Downloading storyboard model… ${modelDownloadPct}%`
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
          {licenseService.isPro() && !proModelInstalled && !modelMissing && (
            <div className="mx-3 mt-2 shrink-0 bg-amber-900/30 border border-amber-700 rounded-lg p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-300">
                ✨ Pro model available — RealVisXL V4.0 gives significantly better panel quality
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
                  <span className="text-xs text-amber-400">{proModelPct}%</span>
                </div>
              )}
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
            onRestoreRevision={handleRestoreRevision}
            onOpenPoseEditor={() => setShowPoseEditor(true)}
            onOpenMotionLibrary={() => setShowMotionLibrary(true)}
            onOpenVideoTransfer={() => setShowVideoTransfer(true)}
            onOpenVoiceStudio={() => setShowVoiceStudio(true)}
            comfyuiConnected={serviceStatus.comfyui === 'connected'}
            wanModelAvailable={wanModelAvailable}
            wanModelWarning={wanModelWarning}
            isPro={licenseService.isPro()}
          />
          <ShotInput
            value={shotInput}
            onChange={setShotInput}
            onGenerate={handleGenerate}
            onOptionsChange={setShotConstraints}
            isGenerating={isGenerating}
            serviceStatus={serviceStatus}
            disabled={false}
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
            isGenerating={isGenerating}
          />
        </div>
      </div>

      {/* Phase 6B — Pose Editor modal */}
      {showPoseEditor && activePanel && (
        <PoseEditor
          panel={activePanel}
          isPro={licenseService.isPro()}
          isGenerating={isPoseGenerating}
          onGenerate={handleGeneratePoseAnimation}
          onClose={() => setShowPoseEditor(false)}
        />
      )}

      {/* Phase 6C — Motion Library modal */}
      {showMotionLibrary && activePanel && (
        <MotionLibrary
          panel={activePanel}
          isPro={licenseService.isPro()}
          comfyuiConnected={serviceStatus.comfyui === 'connected'}
          onApply={handleApplyMotionClip}
          onClose={() => setShowMotionLibrary(false)}
        />
      )}

      {/* Phase 6E — Video Transfer modal */}
      {showVideoTransfer && activePanel && (
        <VideoTransfer
          panel={activePanel}
          characters={project.characters}
          isPro={licenseService.isPro()}
          onComplete={handleVideoTransferComplete}
          onClose={() => setShowVideoTransfer(false)}
        />
      )}

      {/* Phase 15 — Voice Studio modal */}
      {showVoiceStudio && activePanel && (
        <VoiceStudio
          panel={activePanel}
          characters={project.characters}
          isPro={licenseService.isPro()}
          onComplete={handleVoiceComplete}
          onLipSyncComplete={handleLipSyncComplete}
          onOpenSettings={() => { setShowVoiceStudio(false); setShowSettings(true); }}
          onClose={() => setShowVoiceStudio(false)}
        />
      )}

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal
          isPro={licenseService.isPro()}
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
