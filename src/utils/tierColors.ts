import { licenseService as _licenseService } from '../services/LicenseService';

export type Tier = 'community' | 'pro' | 'studio';

export const TIER_COLORS = {
  community: {
    accent: '#ceaf82',
    tailwind: 'imagginary',
  },
  pro: {
    accent: '#4A9EFF',
    tailwind: 'blue',
  },
  studio: {
    accent: '#9B6DFF',
    tailwind: 'violet',
  },
} as const;

type _LS = typeof _licenseService;
export function getTier(ls: { isStudio: () => boolean; isPro: () => boolean }): Tier {
  if (ls.isStudio()) return 'studio';
  if (ls.isPro()) return 'pro';
  return 'community';
}
