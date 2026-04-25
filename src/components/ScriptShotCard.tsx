import React from 'react';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { ScriptShot, Character } from '../types';

interface ScriptShotCardProps {
  shot: ScriptShot;
  index: number;
  total: number;
  characters: Character[];
  onChange: (shot: ScriptShot) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export default function ScriptShotCard({
  shot,
  index,
  total,
  characters,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ScriptShotCardProps) {
  const assignedChars = characters.filter((c) => shot.assignedCharacterIds.includes(c.id));

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-col gap-2">
      {/* Header row — number badge, tags, reorder, delete */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full bg-imagginary-500/20 text-imagginary-400 text-[11px] font-bold flex items-center justify-center">
          {index + 1}
        </span>

        {/* Read-only tags */}
        <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
          {shot.shotType && (
            <Tag label={shot.shotType} color="violet" />
          )}
          {shot.mood && (
            <Tag label={shot.mood} color="blue" />
          )}
          {shot.lighting && (
            <Tag label={shot.lighting} color="gray" />
          )}
        </div>

        {/* Reorder + delete */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
            title="Remove shot"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editable description */}
      <textarea
        rows={2}
        value={shot.shotDescription}
        onChange={(e) => onChange({ ...shot, shotDescription: e.target.value })}
        className="w-full bg-gray-800 border border-gray-700 focus:border-imagginary-500 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors resize-none"
        placeholder="Shot description…"
      />

      {/* Assigned characters */}
      {assignedChars.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {assignedChars.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5">
              {c.referenceImageData ? (
                <img
                  src={c.referenceImageData}
                  alt={c.name}
                  className="w-5 h-5 rounded-full object-cover border border-gray-700"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[9px] text-gray-400 font-bold">
                  {c.name[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[10px] text-gray-400">{c.name} assigned</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tag({ label, color }: { label: string; color: 'violet' | 'blue' | 'gray' }) {
  const cls =
    color === 'violet' ? 'bg-violet-900/40 text-violet-300 border-violet-800/50' :
    color === 'blue'   ? 'bg-blue-900/40 text-blue-300 border-blue-800/50' :
                         'bg-gray-800 text-gray-400 border-gray-700';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${cls} truncate max-w-[120px]`}>
      {label}
    </span>
  );
}
