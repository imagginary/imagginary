import { Zap } from 'lucide-react';

interface ProFeatureGateProps {
  feature: string;
  description: string;
  highlight?: string;
  onUpgrade: () => void;
  tierRequired?: 'pro' | 'studio';
}

export function ProFeatureGate({
  feature,
  description,
  highlight,
  onUpgrade,
  tierRequired = 'pro',
}: ProFeatureGateProps) {
  const isStudioOnly = tierRequired === 'studio';
  const accentColor = isStudioOnly ? 'violet' : 'blue';

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className={`w-10 h-10 rounded-full bg-${accentColor}-500/20 flex items-center justify-center mb-3`}>
        <Zap size={20} className={`text-${accentColor}-400`} />
      </div>
      <h3 className="text-white font-semibold text-sm mb-1">{feature}</h3>
      <p className="text-gray-400 text-xs mb-2 max-w-xs leading-relaxed">{description}</p>
      {highlight && (
        <p className={`text-${accentColor}-400 text-xs mb-4 font-medium`}>✦ {highlight}</p>
      )}
      <button
        onClick={onUpgrade}
        className={`px-4 py-2 bg-${accentColor}-600 hover:bg-${accentColor}-500 text-white text-xs font-medium rounded-lg transition-colors`}
      >
        Upgrade to {isStudioOnly ? 'Studio' : 'Pro'} →
      </button>
    </div>
  );
}
