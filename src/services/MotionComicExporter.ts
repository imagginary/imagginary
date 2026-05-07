import { Panel } from '../types';

export interface MotionComicExportResult {
  success: boolean;
  outputPath?: string;
  message: string;
  error?: string;
}

type ElectronAPI = {
  exportMotionComic: (payload: {
    panels: MotionComicPanel[];
    outputPath: string;
  }) => Promise<MotionComicExportResult>;
  onMotionComicProgress: (cb: (pct: number) => void) => () => void;
  showExportDialog: (options: object) => Promise<{ canceled: boolean; filePath?: string }>;
  openFolder: (path: string) => void;
};

interface MotionComicPanel {
  motionClipPath?: string | null;
  imagePath?: string | null;
  imageData?: string | null;
  duration: number;
  mood?: string | null;
}

export class MotionComicExporter {
  async export(
    panels: Panel[],
    onProgress?: (pct: number) => void,
  ): Promise<MotionComicExportResult> {
    const eligible = panels.filter(
      (p) => p.motionClipPath || p.generatedImagePath || p.generatedImageData,
    );

    if (eligible.length === 0) {
      return {
        success: false,
        message: 'No panels with images or motion clips to export',
        error: 'Generate at least one panel image before exporting',
      };
    }

    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

    if (!electronAPI?.exportMotionComic) {
      return {
        success: false,
        message: 'Electron API not available',
        error: 'Running outside of Electron or preload not loaded',
      };
    }

    const dialogResult = await electronAPI.showExportDialog({
      title: 'Export Motion Comic',
      defaultPath: 'motion-comic.mp4',
      filters: [
        { name: 'Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, message: 'Export cancelled' };
    }

    const outputPath = dialogResult.filePath;

    // Register progress listener before invoking (events fire during invoke)
    let cleanup: (() => void) | undefined;
    if (onProgress) {
      cleanup = electronAPI.onMotionComicProgress(onProgress);
    }

    try {
      const payload = {
        panels: eligible.map((p) => ({
          motionClipPath: p.motionClipPath ?? null,
          imagePath: p.generatedImagePath ?? null,
          imageData: p.generatedImageData ?? null,
          duration: p.duration,
          mood: p.mood ?? null,
        })),
        outputPath,
      };

      const result = await electronAPI.exportMotionComic(payload);

      if (result.success && result.outputPath) {
        electronAPI.openFolder(result.outputPath);
      }

      return result;
    } finally {
      cleanup?.();
    }
  }
}

export const motionComicExporter = new MotionComicExporter();
