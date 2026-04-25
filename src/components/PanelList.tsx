import React, { useRef } from 'react';
import { Plus, GripVertical, Trash2, ImageOff } from 'lucide-react';
import { Panel } from '../types';

interface PanelListProps {
  panels: Panel[];
  activePanelId: string | null;
  onSelectPanel: (id: string) => void;
  onAddPanel: () => void;
  onDeletePanel: (id: string) => void;
  onReorderPanels: (panels: Panel[]) => void;
}

export default function PanelList({
  panels,
  activePanelId,
  onSelectPanel,
  onAddPanel,
  onDeletePanel,
  onReorderPanels,
}: PanelListProps) {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  function handleDragStart(index: number) {
    dragItem.current = index;
  }

  function handleDragEnter(index: number) {
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;

    const reordered = [...panels];
    const dragged = reordered.splice(dragItem.current, 1)[0];
    reordered.splice(dragOverItem.current, 0, dragged);
    const withOrder = reordered.map((p, i) => ({ ...p, order: i }));
    onReorderPanels(withOrder);

    dragItem.current = null;
    dragOverItem.current = null;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Panels</span>
        <span className="text-xs text-gray-600">{panels.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1 space-y-0.5 px-1">
        {panels.map((panel, index) => (
          <div
            key={panel.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => onSelectPanel(panel.id)}
            className={`group relative flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${
              activePanelId === panel.id
                ? 'bg-imagginary-600/20 border border-imagginary-600/40'
                : 'hover:bg-gray-800/60 border border-transparent'
            }`}
          >
            {/* Drag handle */}
            <GripVertical className="w-3 h-3 text-gray-700 group-hover:text-gray-500 shrink-0 cursor-grab" />

            {/* Thumbnail */}
            <div className="w-16 h-9 rounded overflow-hidden bg-gray-800 shrink-0 flex items-center justify-center">
              {panel.generatedImageData ? (
                <img
                  src={panel.generatedImageData}
                  alt={`Panel ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageOff className="w-4 h-4 text-gray-700" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-gray-500 font-mono">#{String(index + 1).padStart(2, '0')}</div>
              <div className="text-xs text-gray-300 truncate leading-tight">
                {panel.shotDescription || <span className="text-gray-600 italic">Empty panel</span>}
              </div>
              {panel.shotType && (
                <div className="text-[10px] text-gray-600 mt-0.5 truncate">{panel.shotType}</div>
              )}
            </div>

            {/* Delete */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeletePanel(panel.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 transition-all"
              title="Delete panel"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {panels.length === 0 && (
          <div className="text-center py-6 text-gray-700 text-xs px-3">
            No panels yet. Add your first shot below.
          </div>
        )}
      </div>

      <div className="px-2 py-2 border-t border-gray-800">
        <button
          onClick={onAddPanel}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded border border-dashed border-gray-700 text-xs text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Panel
        </button>
      </div>
    </div>
  );
}
