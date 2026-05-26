// Widened to string — options driven by FILM_DICTIONARY at runtime
export type ShotType = string;

// ── License / Tier ────────────────────────────────────────────────────────────

export type LicenseTier = 'community' | 'pro' | 'studio';

export interface License {
  key: string;
  tier: LicenseTier;
  email: string;
  activatedAt: number;
  expiresAt: number | null;
}
export type CameraAngle = string;
export type Mood = string;

export type Lighting =
  | 'natural-day'
  | 'golden-hour'
  | 'blue-hour'
  | 'night'
  | 'interior-warm'
  | 'interior-cool'
  | 'backlit'
  | 'side-lit'
  | 'high-contrast'
  | 'low-key'
  | 'high-key'
  | 'neon'
  | 'candlelight';

export type TimeOfDay = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'golden-hour' | 'dusk' | 'night' | 'midnight';

export interface StructuredPrompt {
  subject: string;
  background: string;
  mood: string;
  lighting: string;
  angle: string;
  shotType: string;
  timeOfDay: string;
  additionalDetails?: string;
}

export interface MultiViewPaths {
  front: string;
  frontLeft: string;
  left: string;
  back: string;
  right: string;
  frontRight: string;
}

export type MultiViewAngle = keyof MultiViewPaths;

export type MultiViewStatus = 'idle' | 'generating' | 'ready' | 'failed';

export interface Character {
  id: string;
  name: string;
  description: string;
  // Original generated reference (front-facing portrait from ComfyUI)
  referenceImagePath: string | null;
  referenceImageData: string | null; // base64 for display
  // InstantMesh 6-view output — null until generated
  multiViewPaths: MultiViewPaths | null;
  multiViewData: MultiViewPaths | null; // base64 versions for display
  multiViewStatus: MultiViewStatus;
  projectId: string;
  createdAt: number;
  // Legacy compatibility — kept so old project files still load
  referenceImages?: Record<string, string>;
  // Phase 9 — 3D Mesh / Turntable (Pro+)
  meshPath?: string;           // absolute path to .obj file
  glbPath?: string;            // absolute path to .glb file
  turntableVideoPath?: string; // absolute path to turntable MP4
  meshGeneratedAt?: number;    // unix timestamp
}

export interface MeshResult {
  objPath: string;
  glbPath: string;
  turntableVideoPath: string;
  multiViewPaths: MultiViewPaths;
}

export interface MeshGenerationProgress {
  characterId: string;
  stage: 'generating-mesh' | 'generating-turntable' | 'complete' | 'error';
  pct: number;
  message: string;
  error?: string;
}

export interface PanelRevision {
  id: string;
  imageData: string;
  prompt: string;
  timestamp: number;
  label?: string;
}

export interface Panel {
  id: string;
  order: number;
  shotDescription: string;
  structuredPrompt: StructuredPrompt | null;
  generatedImagePath: string | null;
  generatedImageData: string | null;
  shotType: ShotType | null;
  angle: CameraAngle | null;
  mood: Mood | null;
  characters: string[]; // character ids
  notes: string;
  duration: number; // seconds, 1-10
  editHistory?: string[]; // previous generatedImageData values, max 10 (session undo)
  revisions?: PanelRevision[]; // persistent cross-session revision history, max 20
  // Phase 6 — Motion Layer
  motionDescription: string;       // what the user typed for motion
  motionClipPath: string | null;   // absolute path to generated MP4/WebP
  motionClipData: string | null;   // base64 data URL for browser playback
  // Phase 6B — Pose Engine
  poseClipPath: string | null;     // absolute path to pose-animated MP4
  poseClipData: string | null;     // base64 data URL for browser playback
  // Phase 15 — Voice Layer
  voicePath?: string | null;        // absolute path to generated WAV file
  voiceCharacterId?: string | null; // which character is speaking
  // Phase 15 Pt2 — Lip Sync
  lipSyncPath?: string | null;      // URL or path to generated lip-sync video
  lipSyncData?: string | null;      // base64 data URL for browser playback
  // Aspect ratio override — null means inherit from project.aspectRatioId
  aspectRatioId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StyleProfile {
  id: string;
  name: string;
  description: string;
  loraName: string | null;
  promptSuffix: string;
  negativePrompt: string;   // '' for community styles, style-specific terms for pro
  tier: 'community' | 'pro' | 'studio';
  previewImageUrl: string | null; // null until Phase 8 Pro preview images are added
}

export interface Project {
  id: string;
  title: string;
  panels: Panel[];
  characters: Character[];
  style: StyleProfile;
  filePath: string | null;
  // Project-level default aspect ratio — panels may override per-panel
  aspectRatioId?: string;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionStatus = 'checking' | 'connected' | 'disconnected' | 'error';

export interface ServiceStatus {
  comfyui: ConnectionStatus;
  ollama: ConnectionStatus;
  instantmesh: ConnectionStatus;
}

export interface GenerationProgress {
  panelId: string;
  status: 'queued' | 'parsing' | 'generating' | 'animating' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
  errorLink?: { label: string; url: string };
}

export interface CharacterGenerationProgress {
  characterId: string;
  stage: 'generating-reference' | 'generating-multiview' | 'complete' | 'error';
  message: string;
  error?: string;
}

// ── Phase 6C — Motion Library ─────────────────────────────────────────────────

export type MotionCategory =
  | 'walks' | 'turns' | 'gestures' | 'reactions' | 'combat' | 'emotional'
  | 'cinematic' | 'sports' | 'dance' | 'work' | 'sitting' | 'standing'
  | 'transitions' | 'crowd' | 'nature' | 'vehicle' | 'animal' | 'fight'
  | 'chase' | 'romance' | 'comedy' | 'horror' | 'drama' | 'action'
  | 'slow-motion' | 'running' | 'falling' | 'climbing' | 'swimming' | 'driving';

export interface MotionClip {
  id: string;
  name: string;
  description: string;
  category: MotionCategory | string;
  duration: number;
  thumbnail: string | null;       // base64 SVG data URL rendered from first pose frame
  poseSequencePath: string | null; // absolute path to pose_sequence.json (null for starter)
  tags: string[];
  confidence: number;             // 0-100 quality score
  isStarter?: boolean;
}

export interface MotionLibraryProgress {
  clipId: string;
  stage: 'loading-pose' | 'building-workflow' | 'generating' | 'complete' | 'error';
  pct: number;
  message: string;
  error?: string;
}

// ── Phase 6E — Video Transfer ─────────────────────────────────────────────────

export interface VideoValidationResult {
  valid: boolean;
  duration: number;
  frameCount: number;
  warnings: string[];
  estimatedQuality: number;
  rejectionReason?: string;
}

// ── App Settings (BYOK cloud integrations) ────────────────────────────────────

export interface AppSettings {
  // Phase 15 Pt2 — Lip Sync
  syncsoApiKey: string;
  // Phase 9 — Turntable 3D model picker
  turntable3dProvider: 'instantmesh' | 'meshy' | 'tripo' | '3daistudio';
  meshyApiKey: string;
  tripoApiKey: string;
  threeDaiApiKey: string;
  // Phase 9 — Character consistency (cloud IPAdapter)
  falApiKey: string;
  // Phase 10 — Cloud generation (Muapi)
  cloudGenerationEnabled: boolean;
  muapiApiKey: string;
  muapiEndpoint: string;
  // Phase 13 — Shared Studio (Supabase)
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Advanced — custom service URLs (leave blank for defaults)
  ollamaUrl: string;
  comfyuiUrl: string;
  instantMeshUrl: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  syncsoApiKey: '',
  turntable3dProvider: 'instantmesh',
  meshyApiKey: '',
  tripoApiKey: '',
  threeDaiApiKey: '',
  falApiKey: '',
  cloudGenerationEnabled: false,
  muapiApiKey: '',
  muapiEndpoint: 'https://api.muapi.io/v1/comfyui',
  supabaseUrl: '',
  supabaseAnonKey: '',
  ollamaUrl: '',
  comfyuiUrl: '',
  instantMeshUrl: '',
};

// ── Phase 7 — Script Reader ───────────────────────────────────────────────────

export interface ScriptShot {
  order: number;
  shotDescription: string;
  shotType: string;
  subject: string;
  background: string;
  mood: string;
  lighting: string;
  angle: string;
  timeOfDay: string;            // extracted from scene heading (NIGHT/DAY/DAWN/DUSK)
  characterNames: string[];     // raw names extracted from script
  assignedCharacterIds: string[]; // matched against project.characters
}
