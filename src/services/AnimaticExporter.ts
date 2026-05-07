import { Panel } from '../types';

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  message: string;
  error?: string;
}

type ElectronAPI = {
  exportAnimatic: (panelList: { imagePath: string | null; imageData: string | null; duration: number }[], outputPath: string) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
  onAnimaticProgress: (callback: (percent: number) => void) => () => void;
  showExportDialog: (options: object) => Promise<{ canceled: boolean; filePath?: string }>;
};

export class AnimaticExporter {
  async export(panels: Panel[], onProgress?: (percent: number) => void): Promise<ExportResult> {
    const panelsWithImages = panels.filter((p) => p.generatedImagePath || p.generatedImageData);
    if (panelsWithImages.length === 0) {
      return { success: false, message: 'No generated panels to export', error: 'Generate at least one panel before exporting' };
    }

    const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (!electronAPI) {
      return { success: false, message: 'Electron API not available', error: 'Running outside of Electron' };
    }

    const dialogResult = await electronAPI.showExportDialog({
      title: 'Export Animatic',
      defaultPath: 'animatic.mp4',
      filters: [{ name: 'Video', extensions: ['mp4'] }],
    });

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, message: 'Export cancelled' };
    }

    const panelList = panelsWithImages.map((p) => ({
      imagePath: p.generatedImagePath,
      imageData: p.generatedImageData,
      duration: p.duration,
    }));

    let removeListener: (() => void) | null = null;
    if (onProgress) {
      removeListener = electronAPI.onAnimaticProgress(onProgress);
    }

    try {
      const result = await electronAPI.exportAnimatic(panelList, dialogResult.filePath);
      if (result.success) {
        return { success: true, outputPath: result.outputPath, message: 'Animatic exported successfully' };
      }
      return { success: false, message: 'Export failed', error: result.error };
    } catch (error) {
      return { success: false, message: 'Export failed', error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      removeListener?.();
    }
  }
}

export const animaticExporter = new AnimaticExporter();
