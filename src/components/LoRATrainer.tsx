import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Upload, Check } from 'lucide-react';
import { StyleProfile } from '../types';
import { customStyleService } from '../services/CustomStyleService';
import { comfyUIService } from '../services/ComfyUIService';
import { licenseService, CREDIT_COSTS } from '../services/LicenseService';

interface LoRATrainerProps {
  onClose: () => void;
  onStyleCreated: (style: StyleProfile) => void;
  isStudio: boolean;
}

type Step = 'upload' | 'configure' | 'training' | 'complete';

interface SelectedImage {
  path: string;
  previewUrl: string;
  name: string;
}

const TRAINING_COST = CREDIT_COSTS.loraTraining;

export default function LoRATrainer({ onClose, onStyleCreated, isStudio }: LoRATrainerProps) {
  if (!isStudio) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
        <div className="bg-gray-950 border border-gray-800 rounded-xl p-6 max-w-sm w-full text-center">
          <p className="text-white font-medium mb-2">Studio feature</p>
          <p className="text-gray-400 text-sm mb-4">Brand LoRA training requires a Studio subscription.</p>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-white transition-colors">Close</button>
        </div>
      </div>
    );
  }
  const [step, setStep] = useState<Step>('upload');

  // Upload step state
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configure step state
  const [styleName, setStyleName] = useState('');
  const [triggerWordBase, setTriggerWordBase] = useState('');
  const [promptSuffix, setPromptSuffix] = useState('');
  const [loraStrength, setLoraStrength] = useState(1.0);

  // A fixed random suffix is generated once when the component mounts and reused throughout.
  // This ensures the preview shown to the user matches what's actually sent to training.
  const triggerSuffix = useRef(Math.random().toString(36).substring(2, 6).toUpperCase());
  const triggerWord = triggerWordBase ? `${triggerWordBase}_${triggerSuffix.current}` : '';

  // Training step state
  const [trainingMessage, setTrainingMessage] = useState('');
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [trainingError, setTrainingError] = useState<string | null>(null);

  // Register upload-progress IPC listener for the training phase
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLoraUploadProgress) return;
    const cleanup = api.onLoraUploadProgress((data: { pct: number; current: number; total: number }) => {
      setUploadProgress(data.pct);
      setTrainingMessage(`Uploading images… ${data.current}/${data.total}`);
    });
    return () => cleanup?.();
  }, []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter(
      (f) => f.type === 'image/jpeg' || f.type === 'image/png'
    );
    setSelectedImages((prev) => {
      const remaining = 20 - prev.length;
      const toAdd = valid.slice(0, remaining).map((f) => ({
        path: (f as any).path ?? f.name, // Electron exposes .path; fallback for tests
        previewUrl: URL.createObjectURL(f),
        name: f.name,
      }));
      return [...prev, ...toAdd];
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }

  function removeImage(index: number) {
    setSelectedImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }

  const handleStartTraining = useCallback(async () => {
    setStep('training');
    setTrainingError(null);
    setTrainingProgress(0);

    try {
      // 1. Upload images
      setTrainingMessage('Uploading reference images…');
      const imagePaths = selectedImages.map((img) => img.path);
      const uploadResult = await window.electronAPI!.uploadTrainingImages({ imagePaths });
      if (!uploadResult.success) throw new Error(uploadResult.error);
      const uploadedUrls: string[] = uploadResult.urls ?? [];

      // 2. Submit training job
      setTrainingMessage('Submitting training job to Fal.ai…');
      const trainingResult = await window.electronAPI!.startLoraTraining({
        imageUrls: uploadResult.urls,
        styleName,
        triggerWord,
      });
      if (!trainingResult.success) throw new Error(trainingResult.error);

      const requestId: string = trainingResult.requestId;

      // Save pending style immediately so it shows in StylePicker with "Training…" badge
      const pendingStyle: StyleProfile = {
        id: `custom-${Date.now()}`,
        name: styleName,
        description: `Custom trained style · ${selectedImages.length} reference images`,
        loraName: `${triggerWord.toLowerCase()}_lora`,
        loraStrength,
        promptSuffix: triggerWord ? `${triggerWord}, ${promptSuffix}` : promptSuffix,
        negativePrompt: '',
        tier: 'studio',
        previewImageUrl: null,
        isCustom: true,
        trainingStatus: 'training',
        trainingJobId: requestId,
        trainedAt: Date.now(),
        trainingImageCount: selectedImages.length,
      };
      await customStyleService.saveCustomStyle(pendingStyle);
      onStyleCreated(pendingStyle);

      // 3. Poll for completion (max 80 × 15 s = 20 min)
      setTrainingMessage('Training in progress — this takes ~15 minutes…');
      let loraUrl: string | null = null;

      for (let i = 0; i < 80; i++) {
        await new Promise<void>((r) => setTimeout(r, 15_000));

        const statusResult = await window.electronAPI!.pollLoraTraining({ requestId });
        if (!statusResult.success) throw new Error(statusResult.error);

        const elapsed = Math.round((i + 1) * 15 / 60);
        setTrainingMessage(`Training in progress — ${elapsed} min elapsed…`);
        setTrainingProgress(Math.min(90, Math.round(((i + 1) / 80) * 90)));

        if (statusResult.status === 'COMPLETED') {
          loraUrl = statusResult.loraUrl;
          break;
        }
        if (statusResult.status === 'FAILED') {
          throw new Error('Training failed on Fal.ai — please try again');
        }
      }

      if (!loraUrl) throw new Error('Training timed out after 20 minutes');

      // 4. Download and install LoRA
      setTrainingMessage('Downloading trained LoRA…');
      setTrainingProgress(92);
      const loraName = `${triggerWord.toLowerCase()}_lora`;
      const installResult = await window.electronAPI!.installLora({ loraUrl, loraName });
      if (!installResult.success) throw new Error(installResult.error);

      // 5. Invalidate ComfyUI LoRA cache so next generation picks up the new file
      comfyUIService.invalidateLoraCache();

      // 6. Deduct credits (main process already deducted on submission; sync renderer cache)
      await licenseService.spendCredits(TRAINING_COST);

      // 7. Mark style complete
      const completedStyle: StyleProfile = {
        ...pendingStyle,
        trainingStatus: 'complete',
        loraPath: installResult.userLoraPath,
        loraName: installResult.fileName.replace('.safetensors', ''),
      };
      await customStyleService.saveCustomStyle(completedStyle);
      onStyleCreated(completedStyle);

      setTrainingProgress(100);
      setStep('complete');

      // Best-effort cleanup of uploaded training images from Fal.ai storage (fire-and-forget)
      window.electronAPI?.cleanupTrainingUploads?.({ imageUrls: uploadedUrls }).catch(() => {});
    } catch (err: any) {
      setTrainingError(err?.message ?? 'Unknown error');
      setTrainingMessage('Training failed');
      // Update persisted style to failed if we had a requestId
      // (best-effort; ignore errors)
    }
  }, [selectedImages, styleName, triggerWord, promptSuffix, loraStrength, onStyleCreated]);

  const balance = licenseService.getBalance();
  const totalCredits = balance.subscriptionCredits + balance.topUpCredits;
  const canAfford = licenseService.hasCredits(TRAINING_COST);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-950 border border-gray-800 rounded-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          {step === 'upload' && (
            <div>
              <h2 className="text-white font-semibold text-base">Train Brand Style</h2>
              <p className="text-gray-500 text-xs mt-0.5">Upload 10–20 reference images that represent your visual style</p>
            </div>
          )}
          {step === 'configure' && (
            <div>
              <h2 className="text-white font-semibold text-base">Configure Style</h2>
              <p className="text-gray-500 text-xs mt-0.5">{selectedImages.length} images selected</p>
            </div>
          )}
          {step === 'training' && (
            <h2 className="text-white font-semibold text-base">Training…</h2>
          )}
          {step === 'complete' && (
            <h2 className="text-white font-semibold text-base">Style ready</h2>
          )}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Upload step ── */}
        {step === 'upload' && (
          <>
            <div className="p-6 flex-1 overflow-y-auto min-h-0">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-700 hover:border-violet-500 rounded-xl p-8 text-center cursor-pointer transition-colors mb-4"
              >
                <Upload className="w-8 h-8 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-300 text-sm font-medium">Drop images here or click to browse</p>
                <p className="text-gray-500 text-xs mt-1">
                  JPG, PNG — 10 minimum, 20 maximum · Best results with consistent style
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* Preview grid */}
              {selectedImages.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {selectedImages.map((img, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                      <img src={img.previewUrl} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                        className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Validation warning */}
              {selectedImages.length > 0 && selectedImages.length < 10 && (
                <p className="text-amber-400 text-xs mb-4">
                  Add at least {10 - selectedImages.length} more image{10 - selectedImages.length !== 1 ? 's' : ''} for best results
                </p>
              )}

              {/* Tips */}
              <div className="bg-gray-900 rounded-lg p-4">
                <p className="text-xs font-medium text-gray-300 mb-2">Tips for best results:</p>
                <ul className="text-xs text-gray-500 space-y-1">
                  <li>· Use images from your existing storyboards or artwork</li>
                  <li>· Consistent lighting, color palette, and line style trains better</li>
                  <li>· Mix of different subjects (people, environments, objects) improves generalization</li>
                  <li>· Avoid watermarks, text overlays, or low-resolution images</li>
                </ul>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between shrink-0">
              <p className="text-xs text-gray-500">{TRAINING_COST} credits · ~15 minutes training time</p>
              <button
                onClick={() => setStep('configure')}
                disabled={selectedImages.length < 10}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                Continue →
              </button>
            </div>
          </>
        )}

        {/* ── Configure step ── */}
        {step === 'configure' && (
          <>
            <div className="p-6 flex-1 overflow-y-auto min-h-0 space-y-5">
              {/* Style name */}
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Style name</label>
                <input
                  value={styleName}
                  onChange={(e) => setStyleName(e.target.value)}
                  placeholder="e.g. Dark Nordic Crime, Pastel Anime, Corporate Realism"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Trigger word */}
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">
                  Trigger word
                  <span className="text-gray-500 font-normal ml-1">— a base word that activates your style</span>
                </label>
                <input
                  value={triggerWordBase}
                  onChange={(e) => setTriggerWordBase(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  placeholder="e.g. MYNORDIC, MYBRAND, MYANIME"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none font-mono transition-colors"
                />
                {triggerWordBase ? (
                  <p className="text-xs text-gray-500 mt-1">
                    Final trigger word:{' '}
                    <span className="font-mono text-violet-400">{triggerWord}</span>
                    {' '}— a unique suffix is added automatically to prevent accidental activation in unrelated prompts.
                  </p>
                ) : (
                  <p className="text-xs text-gray-600 mt-1">A unique suffix will be appended automatically to avoid collisions with common words.</p>
                )}
              </div>

              {/* Prompt suffix */}
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">
                  Prompt suffix
                  <span className="text-gray-500 font-normal ml-1">— appended to every generated panel</span>
                </label>
                <input
                  value={promptSuffix}
                  onChange={(e) => setPromptSuffix(e.target.value)}
                  placeholder="e.g. dark moody cinematography, nordic crime aesthetic"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none transition-colors"
                />
              </div>

              {/* LoRA strength */}
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">
                  Style strength: {loraStrength.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={loraStrength}
                  onChange={(e) => setLoraStrength(parseFloat(e.target.value))}
                  className="w-full accent-violet-500"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>Subtle (0.5)</span>
                  <span>Balanced (1.0)</span>
                  <span>Strong (1.5)</span>
                </div>
              </div>

              {/* Credit warning */}
              {!canAfford && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-red-400 text-xs">
                    Insufficient credits. Training costs {TRAINING_COST} credits — you have {totalCredits}.
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between shrink-0">
              <button onClick={() => setStep('upload')} className="text-sm text-gray-400 hover:text-white transition-colors">
                ← Back
              </button>
              <button
                onClick={handleStartTraining}
                disabled={!styleName.trim() || !triggerWordBase.trim() || !canAfford}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                Start Training — {TRAINING_COST} credits
              </button>
            </div>
          </>
        )}

        {/* ── Training step ── */}
        {step === 'training' && (
          <div className="p-6 flex-1 flex flex-col items-center justify-center text-center min-h-0">
            {!trainingError ? (
              <>
                <div className="w-16 h-16 rounded-full border-4 border-violet-500 border-t-transparent animate-spin mb-6" />
                <h3 className="text-white font-medium mb-2 text-sm">{trainingMessage}</h3>
                <div className="w-full max-w-xs bg-gray-800 rounded-full h-1.5 mb-3">
                  <div
                    className="bg-violet-500 h-1.5 rounded-full transition-all duration-1000"
                    style={{ width: `${trainingProgress}%` }}
                  />
                </div>
                <p className="text-gray-600 text-xs max-w-xs">
                  You can close this window — training continues in the background.
                  Your style will appear in the Style Vault when ready.
                </p>
              </>
            ) : (
              <>
                <div className="text-red-400 text-4xl mb-4 font-light">✕</div>
                <h3 className="text-white font-medium mb-2">Training failed</h3>
                <p className="text-red-400 text-sm mb-6 max-w-xs">{trainingError}</p>
                <button
                  onClick={() => { setTrainingError(null); setStep('configure'); }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Complete step ── */}
        {step === 'complete' && (
          <div className="p-6 flex-1 flex flex-col items-center justify-center text-center min-h-0">
            <div className="w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center mb-6">
              <Check className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-white font-semibold text-lg mb-2">"{styleName}" is ready</h3>
            <p className="text-gray-400 text-sm mb-6 max-w-xs">
              Your brand style has been trained and added to your Style Vault.
              Select it in the style picker to use it on any panel.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Start using my style
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
