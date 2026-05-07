import { jsPDF } from 'jspdf';
import { Panel } from '../types';

export interface ProductionExportResult {
  success: boolean;
  message: string;
  error?: string;
}

type ProductionElectronAPI = {
  exportPDF: (base64Data: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
  exportFCPXML: (xmlString: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
};

function getAPI(): ProductionElectronAPI | null {
  return (window as unknown as { electronAPI?: ProductionElectronAPI }).electronAPI ?? null;
}

function pathToFileURL(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getAspectRatio(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
    img.onerror = () => resolve(16 / 9);
    img.src = dataUrl;
  });
}

export class ProductionExporter {
  async exportPDF(panels: Panel[], projectTitle: string): Promise<ProductionExportResult> {
    const api = getAPI();
    if (!api) return { success: false, message: 'Not running in Electron', error: 'Electron API unavailable' };

    const panelsWithImages = panels.filter((p) => p.generatedImageData);
    if (panelsWithImages.length === 0) {
      return { success: false, message: 'No generated panels to export', error: 'Generate at least one panel before exporting' };
    }

    // A4 landscape layout constants (mm)
    const PAGE_W = 297;
    const PAGE_H = 210;
    const MARGIN = 10;
    const GAP = 5;
    const TOP = 12;
    const FOOTER_LINE_Y = PAGE_H - 11;
    const PANEL_W = (PAGE_W - 2 * MARGIN - GAP) / 2; // ~136mm per column

    const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });

    for (let i = 0; i < panelsWithImages.length; i += 2) {
      if (i > 0) doc.addPage();

      const pageNum = Math.floor(i / 2) + 1;
      const totalPages = Math.ceil(panelsWithImages.length / 2);

      for (let slot = 0; slot < 2; slot++) {
        const panelIdx = i + slot;
        if (panelIdx >= panelsWithImages.length) break;

        const panel = panelsWithImages[panelIdx];
        const x = MARGIN + slot * (PANEL_W + GAP);
        let y = TOP;

        const imgData = panel.generatedImageData!;
        const imgFormat = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        const ar = await getAspectRatio(imgData);
        // Cap image height so text area always fits
        const maxImgH = PAGE_H - TOP - FOOTER_LINE_Y - 38;
        const imgH = Math.min(PANEL_W / ar, maxImgH > 0 ? maxImgH : 80);

        // Panel image
        doc.addImage(imgData, imgFormat, x, y, PANEL_W, imgH);
        y += imgH + 3;

        // Panel number + shot type
        doc.setFontSize(7);
        doc.setTextColor(110, 110, 110);
        const badge = `#${String(panel.order + 1).padStart(2, '0')}${panel.shotType ? `  ·  ${panel.shotType}` : ''}`;
        doc.text(badge, x, y);
        y += 4;

        // Shot description (max 2 lines)
        doc.setFontSize(8.5);
        doc.setTextColor(20, 20, 20);
        const descLines = doc.splitTextToSize(panel.shotDescription || '(no description)', PANEL_W);
        const descSlice = descLines.slice(0, 2) as string[];
        doc.text(descSlice, x, y);
        y += descSlice.length * 3.8 + 1.5;

        // Director's notes (max 2 lines)
        if (panel.notes?.trim()) {
          doc.setFontSize(7);
          doc.setTextColor(70, 70, 70);
          const noteLines = doc.splitTextToSize(`Notes: ${panel.notes}`, PANEL_W);
          const noteSlice = noteLines.slice(0, 2) as string[];
          doc.text(noteSlice, x, y);
          y += noteSlice.length * 3.2 + 1;
        }

        // Camera angle · mood metadata row
        const meta = [panel.angle, panel.mood].filter(Boolean).join('  ·  ');
        if (meta) {
          doc.setFontSize(6.5);
          doc.setTextColor(130, 130, 130);
          doc.text(meta, x, y);
        }
      }

      // Footer rule
      doc.setDrawColor(210, 210, 210);
      doc.line(MARGIN, FOOTER_LINE_Y, PAGE_W - MARGIN, FOOTER_LINE_Y);

      // Footer text
      doc.setFontSize(7);
      doc.setTextColor(155, 155, 155);
      doc.text(projectTitle, MARGIN, FOOTER_LINE_Y + 4.5);
      doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, FOOTER_LINE_Y + 4.5, { align: 'right' });
    }

    // Strip data: URI prefix — main process handles raw base64
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

    try {
      const result = await api.exportPDF(base64);
      if (result.canceled) return { success: false, message: 'Export cancelled' };
      if (result.success) return { success: true, message: 'PDF exported successfully' };
      return { success: false, message: 'PDF export failed', error: result.error };
    } catch (err) {
      return { success: false, message: 'PDF export failed', error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  async exportFCPXML(panels: Panel[], projectTitle: string): Promise<ProductionExportResult> {
    const api = getAPI();
    if (!api) return { success: false, message: 'Not running in Electron', error: 'Electron API unavailable' };

    const panelsWithImages = panels.filter((p) => p.generatedImageData && p.generatedImagePath);
    if (panelsWithImages.length === 0) {
      return {
        success: false,
        message: 'No saved panel images found',
        error: 'Panels must be generated and saved before exporting XML. If running outside Electron, image paths are unavailable.',
      };
    }

    const FPS = 24;

    // Build per-panel metadata
    const items = panelsWithImages.map((panel, idx) => {
      const assetId = `a${idx + 1}`;
      const src = pathToFileURL(panel.generatedImagePath!);
      const durationSec = panel.duration || 3;
      const durationFrames = durationSec * FPS;
      const durationStr = `${durationFrames}/${FPS}s`;
      const name = escapeXml(`Panel ${String(panel.order + 1).padStart(2, '0')}: ${panel.shotDescription || ''}`.slice(0, 80));
      return { panel, assetId, src, durationSec, durationFrames, durationStr, name };
    });

    const totalFrames = items.reduce((sum, a) => sum + a.durationFrames, 0);

    const assetsXml = items
      .map(
        (a) =>
          `    <asset id="${a.assetId}" name="${a.name}" src="${a.src}" start="0s" duration="${a.durationStr}" hasVideo="1" hasAudio="0" videoSources="1">\n` +
          `      <media-rep kind="original-media" src="${a.src}"/>\n` +
          `    </asset>`,
      )
      .join('\n');

    let offset = 0;
    const clipsXml = items
      .map((a) => {
        const offsetStr = `${offset}/${FPS}s`;
        offset += a.durationFrames;
        return `          <clip name="${a.name}" ref="${a.assetId}" offset="${offsetStr}" duration="${a.durationStr}" start="0s"/>`;
      })
      .join('\n');

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE fcpxml>\n` +
      `<fcpxml version="1.9">\n` +
      `  <resources>\n` +
      `    <format id="r1" name="FFVideoFormat1080p24" frameDuration="1/${FPS}s" width="1920" height="1080"/>\n` +
      assetsXml + '\n' +
      `  </resources>\n` +
      `  <library>\n` +
      `    <event name="${escapeXml(projectTitle)}">\n` +
      `      <project name="${escapeXml(projectTitle)}">\n` +
      `        <sequence format="r1" duration="${totalFrames}/${FPS}s" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n` +
      `          <spine>\n` +
      clipsXml + '\n' +
      `          </spine>\n` +
      `        </sequence>\n` +
      `      </project>\n` +
      `    </event>\n` +
      `  </library>\n` +
      `</fcpxml>`;

    try {
      const result = await api.exportFCPXML(xml);
      if (result.canceled) return { success: false, message: 'Export cancelled' };
      if (result.success) return { success: true, message: 'FCPXML exported successfully' };
      return { success: false, message: 'FCPXML export failed', error: result.error };
    } catch (err) {
      return { success: false, message: 'FCPXML export failed', error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}

export const productionExporter = new ProductionExporter();
