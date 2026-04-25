import React, { useState } from 'react';
import { UserPlus, Trash2, ChevronDown, ChevronRight, CheckCircle, Loader2, AlertCircle, ImageOff } from 'lucide-react';
import { Character, CharacterGenerationProgress } from '../types';

interface CharacterLibraryProps {
  characters: Character[];
  onCreateCharacter: (name: string, description: string) => void;
  onDeleteCharacter: (id: string) => void;
  generationProgress: CharacterGenerationProgress | null;
}

const ANGLE_LABELS: Array<{ key: keyof Character['multiViewData'] & string; label: string }> = [
  { key: 'front',      label: 'Front' },
  { key: 'frontLeft',  label: '¾ L' },
  { key: 'left',       label: 'Side L' },
  { key: 'back',       label: 'Back' },
  { key: 'right',      label: 'Side R' },
  { key: 'frontRight', label: '¾ R' },
];

function MultiViewGrid({ data }: { data: NonNullable<Character['multiViewData']> }) {
  return (
    <div className="grid grid-cols-3 gap-1 px-1 pb-2">
      {ANGLE_LABELS.map(({ key, label }) => (
        <div key={key} className="flex flex-col items-center gap-0.5">
          <div className="w-full aspect-square bg-gray-800 rounded overflow-hidden">
            {data[key] ? (
              <img src={data[key]} alt={label} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageOff className="w-3 h-3 text-gray-700" />
              </div>
            )}
          </div>
          <span className="text-[9px] text-gray-600">{label}</span>
        </div>
      ))}
    </div>
  );
}

function CharacterRow({
  character,
  onDelete,
  isGenerating,
}: {
  character: Character;
  onDelete: () => void;
  isGenerating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMultiView = character.multiViewStatus === 'ready' && character.multiViewData;

  return (
    <div className="border-b border-gray-800/50 last:border-0">
      <div
        className="group flex items-center gap-2 px-2 py-1.5 hover:bg-gray-800/40 transition-colors cursor-pointer"
        onClick={() => hasMultiView && setExpanded((v) => !v)}
      >
        {/* Expand toggle */}
        <div className="w-3 shrink-0 text-gray-700">
          {hasMultiView
            ? (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)
            : <span className="w-3 block" />}
        </div>

        {/* Thumbnail */}
        <div className="w-7 h-7 rounded bg-gray-800 overflow-hidden shrink-0 flex items-center justify-center">
          {character.referenceImageData ? (
            <img src={character.referenceImageData} alt={character.name} className="w-full h-full object-cover" />
          ) : (
            <ImageOff className="w-3 h-3 text-gray-700" />
          )}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-300 truncate">{character.name}</div>
          <div className="flex items-center gap-1 mt-0.5">
            {character.multiViewStatus === 'ready' && (
              <CheckCircle className="w-2.5 h-2.5 text-green-500 shrink-0" />
            )}
            {(character.multiViewStatus === 'generating' || isGenerating) && (
              <Loader2 className="w-2.5 h-2.5 text-imagginary-400 animate-spin shrink-0" />
            )}
            {character.multiViewStatus === 'failed' && (
              <AlertCircle className="w-2.5 h-2.5 text-red-500 shrink-0" />
            )}
            <span className="text-[9px] text-gray-600">
              {character.multiViewStatus === 'ready' && 'Multi-view ready'}
              {(character.multiViewStatus === 'generating' || isGenerating) && 'Generating views…'}
              {character.multiViewStatus === 'failed' && 'Multi-view failed'}
              {character.multiViewStatus === 'idle' && !isGenerating && character.description}
            </span>
          </div>
        </div>

        {/* Delete */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 transition-all shrink-0"
          title="Delete character"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {expanded && hasMultiView && character.multiViewData && (
        <MultiViewGrid data={character.multiViewData} />
      )}
    </div>
  );
}

export default function CharacterLibrary({
  characters,
  onCreateCharacter,
  onDeleteCharacter,
  generationProgress,
}: CharacterLibraryProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  function handleAdd() {
    if (!newName.trim()) return;
    onCreateCharacter(newName.trim(), newDesc.trim());
    setNewName('');
    setNewDesc('');
    setIsAdding(false);
  }

  const activeId = generationProgress?.characterId;

  return (
    <div className="flex flex-col max-h-72 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Characters</span>
        <button
          onClick={() => setIsAdding((v) => !v)}
          className="p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
          title="Add character"
        >
          <UserPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New character form */}
      {isAdding && (
        <div className="px-2 py-2 space-y-1.5 bg-gray-900/60 border-b border-gray-800 shrink-0">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Character name"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-imagginary-600"
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Description — e.g. middle-aged detective, trench coat"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-imagginary-600"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="flex-1 py-1.5 bg-imagginary-600 hover:bg-imagginary-500 disabled:bg-gray-800 disabled:text-gray-600 text-black text-xs font-semibold rounded transition-colors"
            >
              Generate Character
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Generation progress banner */}
      {generationProgress && generationProgress.stage !== 'complete' && generationProgress.stage !== 'error' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-imagginary-950/30 border-b border-imagginary-800/20 shrink-0">
          <Loader2 className="w-3 h-3 text-imagginary-400 animate-spin shrink-0" />
          <span className="text-[10px] text-imagginary-400 truncate">{generationProgress.message}</span>
        </div>
      )}
      {generationProgress?.stage === 'error' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/30 border-b border-red-800/20 shrink-0">
          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400 truncate">{generationProgress.error ?? 'Character generation failed'}</span>
        </div>
      )}

      {/* Character list */}
      <div className="overflow-y-auto flex-1">
        {characters.map((character) => (
          <CharacterRow
            key={character.id}
            character={character}
            onDelete={() => onDeleteCharacter(character.id)}
            isGenerating={activeId === character.id && generationProgress?.stage === 'generating-multiview'}
          />
        ))}
        {characters.length === 0 && (
          <div className="px-3 py-3 text-[10px] text-gray-700 text-center">
            No characters defined
          </div>
        )}
      </div>
    </div>
  );
}
