/**
 * Phase 6B — Pose Vocabulary
 *
 * 17-joint OpenPose skeleton. All coordinates normalised to [0, 1]
 * within the bounding box (0,0 = top-left, 1,1 = bottom-right).
 *
 * Joint order (index 0-16):
 *   0  nose
 *   1  left_eye    2  right_eye
 *   3  left_ear    4  right_ear
 *   5  left_shoulder   6  right_shoulder
 *   7  left_elbow      8  right_elbow
 *   9  left_wrist     10  right_wrist
 *  11  left_hip       12  right_hip
 *  13  left_knee      14  right_knee
 *  15  left_ankle     16  right_ankle
 */

export interface Joint {
  x: number; // 0-1
  y: number; // 0-1
}

/** A single pose keyframe — one set of joint positions. */
export interface PoseKeyframe {
  /** 17 joints in the order above. Use null for occluded / unknown joints. */
  joints: (Joint | null)[];
  /** Optional transition hint for the animator. */
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export type PoseCategory =
  | 'standing'
  | 'sitting'
  | 'action'
  | 'combat'
  | 'expressive'
  | 'ground'
  | 'cinematic';

export interface PoseTemplate {
  id: string;
  name: string;
  description: string;
  category: PoseCategory;
  /** Static reference keyframe — shown in the browser grid. */
  keyframe: PoseKeyframe;
  /** Optional multi-keyframe animation sequence (for timeline preview). */
  sequence?: PoseKeyframe[];
  /** Tags for search. */
  tags: string[];
}

// ─── Helper: build a joint array quickly ────────────────────────────────────
function j(...coords: [number, number][]): (Joint | null)[] {
  // Ensure exactly 17 entries
  const out: (Joint | null)[] = Array(17).fill(null);
  coords.forEach(([x, y], i) => { out[i] = { x, y }; });
  return out;
}

// ─── Pose Library ────────────────────────────────────────────────────────────

export const POSE_VOCABULARY: PoseTemplate[] = [
  // ── STANDING ──────────────────────────────────────────────────────────────
  {
    id: 'standing-neutral',
    name: 'Standing Neutral',
    category: 'standing',
    description: 'Upright, arms at sides.',
    tags: ['neutral', 'idle', 'default'],
    keyframe: { joints: j(
      [0.50, 0.08],  // nose
      [0.47, 0.06], [0.53, 0.06],  // eyes
      [0.44, 0.07], [0.56, 0.07],  // ears
      [0.42, 0.20], [0.58, 0.20],  // shoulders
      [0.40, 0.36], [0.60, 0.36],  // elbows
      [0.38, 0.51], [0.62, 0.51],  // wrists
      [0.44, 0.52], [0.56, 0.52],  // hips
      [0.44, 0.70], [0.56, 0.70],  // knees
      [0.44, 0.90], [0.56, 0.90],  // ankles
    )},
  },
  {
    id: 'standing-arms-crossed',
    name: 'Arms Crossed',
    category: 'standing',
    description: 'Defensive or confident — arms folded across chest.',
    tags: ['defensive', 'confident', 'standoff'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.54, 0.29], [0.46, 0.29],  // elbows cross in
      [0.58, 0.31], [0.42, 0.31],  // wrists cross
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'standing-hands-on-hips',
    name: 'Hands on Hips',
    category: 'standing',
    description: 'Power pose — hands resting on hips.',
    tags: ['power', 'confident', 'heroic'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.35, 0.38], [0.65, 0.38],
      [0.40, 0.52], [0.60, 0.52],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'standing-one-arm-raised',
    name: 'One Arm Raised',
    category: 'standing',
    description: 'Reaching up or pointing.',
    tags: ['reach', 'point', 'gesture'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.40, 0.36], [0.62, 0.08],  // right elbow up
      [0.38, 0.51], [0.64, 0.02],  // right wrist above head
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'standing-arms-spread',
    name: 'Arms Spread Wide',
    category: 'standing',
    description: 'Welcoming or dramatic open-arm gesture.',
    tags: ['welcoming', 'dramatic', 'open'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.25, 0.25], [0.75, 0.25],
      [0.10, 0.30], [0.90, 0.30],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'standing-back-to-camera',
    name: 'Back to Camera',
    category: 'standing',
    description: 'Character faces away — mysterious or brooding.',
    tags: ['mysterious', 'brooding', 'rear'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.065], [0.53, 0.065],
      [0.44, 0.075], [0.56, 0.075],
      [0.42, 0.20], [0.58, 0.20],
      [0.40, 0.35], [0.60, 0.35],
      [0.39, 0.50], [0.61, 0.50],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'standing-contrapposto',
    name: 'Contrapposto',
    category: 'standing',
    description: 'Classical weight-shift stance — elegant.',
    tags: ['elegant', 'classical', 'weight shift'],
    keyframe: { joints: j(
      [0.51, 0.08],
      [0.48, 0.06], [0.54, 0.06],
      [0.45, 0.07], [0.57, 0.07],
      [0.41, 0.21], [0.59, 0.20],
      [0.38, 0.37], [0.61, 0.36],
      [0.36, 0.52], [0.63, 0.51],
      [0.43, 0.53], [0.57, 0.52],
      [0.42, 0.71], [0.57, 0.70],
      [0.42, 0.91], [0.58, 0.89],
    )},
  },
  {
    id: 'standing-prayer',
    name: 'Praying Hands',
    category: 'standing',
    description: 'Hands clasped at chest in prayer or supplication.',
    tags: ['prayer', 'supplication', 'reverence'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.44, 0.32], [0.56, 0.32],
      [0.48, 0.38], [0.52, 0.38],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },

  // ── SITTING ──────────────────────────────────────────────────────────────
  {
    id: 'sitting-upright',
    name: 'Sitting Upright',
    category: 'sitting',
    description: 'Seated with straight back.',
    tags: ['seated', 'upright', 'formal'],
    keyframe: { joints: j(
      [0.50, 0.10],
      [0.47, 0.08], [0.53, 0.08],
      [0.44, 0.09], [0.56, 0.09],
      [0.42, 0.22], [0.58, 0.22],
      [0.40, 0.38], [0.60, 0.38],
      [0.38, 0.52], [0.62, 0.52],
      [0.43, 0.54], [0.57, 0.54],
      [0.38, 0.75], [0.62, 0.75],
      [0.36, 0.92], [0.64, 0.92],
    )},
  },
  {
    id: 'sitting-leaning-forward',
    name: 'Leaning Forward',
    category: 'sitting',
    description: 'Seated, leaning in — engaged or conspiratorial.',
    tags: ['engaged', 'conspiratorial', 'intense'],
    keyframe: { joints: j(
      [0.50, 0.14],
      [0.47, 0.12], [0.53, 0.12],
      [0.44, 0.13], [0.56, 0.13],
      [0.40, 0.26], [0.56, 0.24],
      [0.36, 0.40], [0.56, 0.38],
      [0.32, 0.52], [0.56, 0.52],
      [0.42, 0.58], [0.56, 0.58],
      [0.38, 0.77], [0.62, 0.77],
      [0.36, 0.94], [0.64, 0.94],
    )},
  },
  {
    id: 'sitting-casual',
    name: 'Sitting Casual',
    category: 'sitting',
    description: 'Relaxed seated pose — one arm resting.',
    tags: ['casual', 'relaxed', 'informal'],
    keyframe: { joints: j(
      [0.50, 0.10],
      [0.47, 0.08], [0.53, 0.08],
      [0.44, 0.09], [0.56, 0.09],
      [0.42, 0.22], [0.58, 0.22],
      [0.35, 0.36], [0.62, 0.36],
      [0.30, 0.48], [0.65, 0.50],
      [0.43, 0.54], [0.57, 0.54],
      [0.38, 0.75], [0.62, 0.75],
      [0.36, 0.92], [0.64, 0.92],
    )},
  },
  {
    id: 'sitting-cross-legged',
    name: 'Cross-Legged',
    category: 'sitting',
    description: 'Floor-seated meditation or campfire pose.',
    tags: ['meditation', 'floor', 'calm'],
    keyframe: { joints: j(
      [0.50, 0.10],
      [0.47, 0.08], [0.53, 0.08],
      [0.44, 0.09], [0.56, 0.09],
      [0.42, 0.22], [0.58, 0.22],
      [0.40, 0.38], [0.60, 0.38],
      [0.42, 0.54], [0.58, 0.54],
      [0.43, 0.56], [0.57, 0.56],
      [0.33, 0.76], [0.67, 0.76],
      [0.47, 0.85], [0.53, 0.85],
    )},
  },

  // ── ACTION ─────────────────────────────────────────────────────────────────
  {
    id: 'action-running',
    name: 'Running',
    category: 'action',
    description: 'Mid-stride sprint — dynamic forward lean.',
    tags: ['running', 'sprint', 'chase'],
    keyframe: { joints: j(
      [0.52, 0.08],
      [0.50, 0.06], [0.55, 0.06],
      [0.47, 0.07], [0.58, 0.07],
      [0.44, 0.18], [0.60, 0.17],
      [0.36, 0.28], [0.65, 0.32],
      [0.31, 0.40], [0.68, 0.20],  // arms pumping
      [0.46, 0.48], [0.58, 0.47],
      [0.52, 0.64], [0.42, 0.66],  // knees out
      [0.56, 0.82], [0.38, 0.88],
    )},
  },
  {
    id: 'action-jumping',
    name: 'Jumping',
    category: 'action',
    description: 'Airborne leap — both feet off the ground.',
    tags: ['jump', 'leap', 'airborne'],
    keyframe: { joints: j(
      [0.50, 0.06],
      [0.47, 0.04], [0.53, 0.04],
      [0.44, 0.05], [0.56, 0.05],
      [0.42, 0.18], [0.58, 0.18],
      [0.32, 0.22], [0.68, 0.22],  // arms up
      [0.26, 0.14], [0.74, 0.14],  // wrists above
      [0.44, 0.48], [0.56, 0.48],
      [0.40, 0.66], [0.60, 0.66],  // knees bent
      [0.38, 0.84], [0.62, 0.84],
    )},
  },
  {
    id: 'action-punching',
    name: 'Punching',
    category: 'action',
    description: 'Powerful right-hand punch fully extended.',
    tags: ['punch', 'fight', 'attack', 'power'],
    keyframe: { joints: j(
      [0.54, 0.10],
      [0.51, 0.08], [0.57, 0.08],
      [0.48, 0.09], [0.60, 0.09],
      [0.44, 0.22], [0.60, 0.20],
      [0.40, 0.36], [0.78, 0.22],  // right arm extended
      [0.37, 0.50], [0.93, 0.20],  // right wrist far forward
      [0.45, 0.52], [0.57, 0.51],
      [0.44, 0.70], [0.57, 0.70],
      [0.43, 0.90], [0.58, 0.90],
    )},
  },
  {
    id: 'action-kicking',
    name: 'Kicking',
    category: 'action',
    description: 'High front kick — knee raised, leg extended.',
    tags: ['kick', 'martial arts', 'fight'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.35, 0.30], [0.65, 0.30],
      [0.30, 0.42], [0.70, 0.42],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.68, 0.40],  // right knee raised
      [0.44, 0.90], [0.80, 0.30],  // right foot extended
    )},
  },
  {
    id: 'action-climbing',
    name: 'Climbing',
    category: 'action',
    description: 'Arms reaching up, body angled — climbing a wall or rope.',
    tags: ['climb', 'reach', 'vertical'],
    keyframe: { joints: j(
      [0.50, 0.12],
      [0.47, 0.10], [0.53, 0.10],
      [0.44, 0.11], [0.56, 0.11],
      [0.42, 0.24], [0.58, 0.22],
      [0.34, 0.12], [0.68, 0.08],  // arms raised to grips
      [0.28, 0.04], [0.74, 0.02],
      [0.44, 0.56], [0.56, 0.54],
      [0.42, 0.72], [0.60, 0.68],
      [0.40, 0.88], [0.62, 0.84],
    )},
  },
  {
    id: 'action-crouching',
    name: 'Crouching',
    category: 'action',
    description: 'Low stealth crouch — ready to spring.',
    tags: ['crouch', 'stealth', 'hide'],
    keyframe: { joints: j(
      [0.50, 0.22],
      [0.47, 0.20], [0.53, 0.20],
      [0.44, 0.21], [0.56, 0.21],
      [0.42, 0.34], [0.58, 0.34],
      [0.38, 0.46], [0.62, 0.46],
      [0.35, 0.58], [0.65, 0.58],
      [0.44, 0.64], [0.56, 0.64],
      [0.42, 0.80], [0.58, 0.80],
      [0.41, 0.90], [0.59, 0.90],
    )},
  },
  {
    id: 'action-diving',
    name: 'Diving / Lunging',
    category: 'action',
    description: 'Full-body forward dive or lunge.',
    tags: ['dive', 'lunge', 'forward', 'rescue'],
    keyframe: { joints: j(
      [0.55, 0.30],
      [0.52, 0.28], [0.58, 0.28],
      [0.49, 0.29], [0.61, 0.29],
      [0.48, 0.38], [0.65, 0.36],
      [0.38, 0.30], [0.76, 0.40],
      [0.26, 0.22], [0.88, 0.48],
      [0.50, 0.56], [0.62, 0.54],
      [0.44, 0.72], [0.70, 0.64],
      [0.38, 0.86], [0.78, 0.76],
    )},
  },

  // ── COMBAT ─────────────────────────────────────────────────────────────────
  {
    id: 'combat-guard',
    name: 'Guard Stance',
    category: 'combat',
    description: 'Boxing guard — fists raised, weight forward.',
    tags: ['boxing', 'guard', 'defense'],
    keyframe: { joints: j(
      [0.51, 0.10],
      [0.48, 0.08], [0.54, 0.08],
      [0.45, 0.09], [0.57, 0.09],
      [0.43, 0.22], [0.59, 0.21],
      [0.40, 0.29], [0.62, 0.30],
      [0.42, 0.18], [0.60, 0.20],  // fists up
      [0.45, 0.54], [0.57, 0.53],
      [0.44, 0.71], [0.57, 0.71],
      [0.43, 0.91], [0.58, 0.91],
    )},
  },
  {
    id: 'combat-sword-raised',
    name: 'Sword Raised',
    category: 'combat',
    description: 'Two-handed weapon raised overhead — dramatic strike pose.',
    tags: ['sword', 'weapon', 'overhead strike'],
    keyframe: { joints: j(
      [0.50, 0.10],
      [0.47, 0.08], [0.53, 0.08],
      [0.44, 0.09], [0.56, 0.09],
      [0.42, 0.22], [0.58, 0.22],
      [0.36, 0.10], [0.64, 0.10],  // elbows high
      [0.32, 0.02], [0.68, 0.02],  // wrists at apex
      [0.44, 0.54], [0.56, 0.54],
      [0.43, 0.72], [0.57, 0.72],
      [0.42, 0.92], [0.58, 0.92],
    )},
  },
  {
    id: 'combat-gun-aim',
    name: 'Gun Aim (Two-Handed)',
    category: 'combat',
    description: 'Isosceles pistol stance — both arms extended forward.',
    tags: ['gun', 'aim', 'pistol', 'tactical'],
    keyframe: { joints: j(
      [0.52, 0.10],
      [0.49, 0.08], [0.55, 0.08],
      [0.46, 0.09], [0.58, 0.09],
      [0.44, 0.22], [0.60, 0.21],
      [0.52, 0.28], [0.68, 0.26],
      [0.64, 0.26], [0.80, 0.24],  // both arms forward
      [0.45, 0.54], [0.57, 0.53],
      [0.44, 0.72], [0.57, 0.72],
      [0.43, 0.92], [0.58, 0.92],
    )},
  },
  {
    id: 'combat-sniper-prone',
    name: 'Sniper Prone',
    category: 'combat',
    description: 'Lying flat — elbows on ground, weapon trained forward.',
    tags: ['sniper', 'prone', 'lying', 'stealth'],
    keyframe: { joints: j(
      [0.18, 0.54],
      [0.15, 0.52], [0.21, 0.52],
      [0.12, 0.53], [0.24, 0.53],
      [0.30, 0.58], [0.46, 0.60],
      [0.40, 0.64], [0.58, 0.62],
      [0.52, 0.66], [0.70, 0.64],
      [0.54, 0.68], [0.66, 0.70],
      [0.66, 0.74], [0.78, 0.76],
      [0.76, 0.80], [0.88, 0.82],
    )},
  },

  // ── EXPRESSIVE ─────────────────────────────────────────────────────────────
  {
    id: 'expressive-despair',
    name: 'Despair / Grief',
    category: 'expressive',
    description: 'Head bowed, shoulders slumped — raw emotion.',
    tags: ['grief', 'despair', 'sad', 'emotional'],
    keyframe: { joints: j(
      [0.50, 0.16],
      [0.47, 0.14], [0.53, 0.14],
      [0.44, 0.15], [0.56, 0.15],
      [0.41, 0.25], [0.57, 0.25],
      [0.38, 0.40], [0.62, 0.40],
      [0.40, 0.54], [0.60, 0.54],
      [0.43, 0.56], [0.57, 0.56],
      [0.42, 0.74], [0.58, 0.74],
      [0.42, 0.92], [0.58, 0.92],
    )},
  },
  {
    id: 'expressive-triumph',
    name: 'Triumph',
    category: 'expressive',
    description: 'Both fists raised in victory.',
    tags: ['victory', 'triumph', 'cheer', 'hero'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.32, 0.10], [0.68, 0.10],
      [0.28, 0.02], [0.72, 0.02],
      [0.44, 0.52], [0.56, 0.52],
      [0.43, 0.70], [0.57, 0.70],
      [0.43, 0.90], [0.57, 0.90],
    )},
  },
  {
    id: 'expressive-pointing',
    name: 'Pointing / Accusing',
    category: 'expressive',
    description: 'Dramatic accusatory point — one arm fully extended.',
    tags: ['pointing', 'accuse', 'dramatic', 'gesture'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.38, 0.34], [0.70, 0.24],
      [0.36, 0.48], [0.84, 0.20],  // right arm fully extended
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'expressive-shrug',
    name: 'Shrug',
    category: 'expressive',
    description: 'Shoulders raised, palms up — uncertainty or indifference.',
    tags: ['shrug', 'uncertain', 'confused', 'comedy'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.41, 0.17], [0.59, 0.17],  // shoulders raised
      [0.34, 0.28], [0.66, 0.28],  // elbows out
      [0.30, 0.22], [0.70, 0.22],  // palms up
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'expressive-surrender',
    name: 'Surrender',
    category: 'expressive',
    description: 'Hands raised — surrender or disbelief.',
    tags: ['surrender', 'hands up', 'disbelief'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.36, 0.12], [0.64, 0.12],
      [0.34, 0.04], [0.66, 0.04],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'expressive-thinking',
    name: 'Thinking / Pondering',
    category: 'expressive',
    description: 'One hand at chin — contemplative.',
    tags: ['think', 'ponder', 'contemplate', 'smart'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.38, 0.34], [0.60, 0.32],
      [0.36, 0.48], [0.52, 0.16],  // right hand near chin
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'expressive-facepalm',
    name: 'Facepalm',
    category: 'expressive',
    description: 'Hand covering face — exasperation or embarrassment.',
    tags: ['facepalm', 'embarrassed', 'exasperated', 'comedy'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.38, 0.34], [0.58, 0.30],
      [0.36, 0.48], [0.50, 0.10],  // right palm over face
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },

  // ── GROUND ────────────────────────────────────────────────────────────────
  {
    id: 'ground-fallen',
    name: 'Fallen',
    category: 'ground',
    description: 'Collapsed on the ground — defeated or unconscious.',
    tags: ['fallen', 'collapse', 'defeated', 'dead'],
    keyframe: { joints: j(
      [0.14, 0.50],
      [0.11, 0.48], [0.17, 0.48],
      [0.08, 0.49], [0.20, 0.49],
      [0.26, 0.54], [0.42, 0.56],
      [0.38, 0.48], [0.56, 0.58],
      [0.46, 0.44], [0.64, 0.62],
      [0.52, 0.60], [0.64, 0.62],
      [0.64, 0.70], [0.76, 0.72],
      [0.74, 0.78], [0.86, 0.80],
    )},
  },
  {
    id: 'ground-kneeling',
    name: 'Kneeling',
    category: 'ground',
    description: 'One knee down — proposal, reverence, or exhaustion.',
    tags: ['kneel', 'proposal', 'reverence', 'exhausted'],
    keyframe: { joints: j(
      [0.50, 0.14],
      [0.47, 0.12], [0.53, 0.12],
      [0.44, 0.13], [0.56, 0.13],
      [0.42, 0.26], [0.58, 0.26],
      [0.39, 0.42], [0.61, 0.42],
      [0.37, 0.58], [0.63, 0.58],
      [0.43, 0.60], [0.57, 0.60],
      [0.43, 0.76], [0.66, 0.82],  // right knee on ground
      [0.42, 0.92], [0.70, 0.92],
    )},
  },
  {
    id: 'ground-push-up',
    name: 'Push-Up Position',
    category: 'ground',
    description: 'Plank / push-up — horizontal body, arms supporting.',
    tags: ['push-up', 'plank', 'exercise', 'training'],
    keyframe: { joints: j(
      [0.14, 0.36],
      [0.11, 0.34], [0.17, 0.34],
      [0.08, 0.35], [0.20, 0.35],
      [0.26, 0.40], [0.42, 0.44],
      [0.32, 0.52], [0.52, 0.54],
      [0.28, 0.60], [0.56, 0.62],
      [0.54, 0.52], [0.68, 0.54],
      [0.70, 0.58], [0.82, 0.60],
      [0.80, 0.64], [0.92, 0.66],
    )},
  },
  {
    id: 'ground-crawling',
    name: 'Crawling',
    category: 'ground',
    description: 'On hands and knees — stealth, injury, or dramatic moment.',
    tags: ['crawl', 'stealth', 'injured', 'ground'],
    keyframe: { joints: j(
      [0.20, 0.42],
      [0.17, 0.40], [0.23, 0.40],
      [0.14, 0.41], [0.26, 0.41],
      [0.30, 0.48], [0.48, 0.50],
      [0.24, 0.58], [0.52, 0.58],
      [0.20, 0.68], [0.56, 0.68],
      [0.48, 0.60], [0.64, 0.62],
      [0.54, 0.74], [0.72, 0.76],
      [0.52, 0.84], [0.76, 0.86],
    )},
  },

  // ── CINEMATIC ────────────────────────────────────────────────────────────
  {
    id: 'cinematic-silhouette',
    name: 'Silhouette Stance',
    category: 'cinematic',
    description: 'Arms slightly out, feet apart — classic hero silhouette.',
    tags: ['silhouette', 'hero', 'iconic', 'cinematic'],
    keyframe: { joints: j(
      [0.50, 0.07],
      [0.47, 0.05], [0.53, 0.05],
      [0.44, 0.06], [0.56, 0.06],
      [0.40, 0.19], [0.60, 0.19],
      [0.32, 0.32], [0.68, 0.32],
      [0.28, 0.46], [0.72, 0.46],
      [0.43, 0.52], [0.57, 0.52],
      [0.40, 0.70], [0.60, 0.70],
      [0.38, 0.92], [0.62, 0.92],
    )},
  },
  {
    id: 'cinematic-over-shoulder',
    name: 'Over Shoulder Turn',
    category: 'cinematic',
    description: 'Three-quarter turn, looking back — goodbye or warning.',
    tags: ['over shoulder', 'turn', 'cinematic', 'departure'],
    keyframe: { joints: j(
      [0.44, 0.10],
      [0.41, 0.08], [0.47, 0.08],
      [0.38, 0.09], [0.50, 0.09],
      [0.40, 0.22], [0.56, 0.21],
      [0.36, 0.36], [0.60, 0.35],
      [0.34, 0.50], [0.62, 0.50],
      [0.42, 0.54], [0.56, 0.54],
      [0.41, 0.72], [0.56, 0.72],
      [0.40, 0.92], [0.56, 0.92],
    )},
  },
  {
    id: 'cinematic-dramatic-fall',
    name: 'Dramatic Fall',
    category: 'cinematic',
    description: 'Mid-fall — body arched backward, arms out.',
    tags: ['fall', 'dramatic', 'death', 'collapse'],
    keyframe: { joints: j(
      [0.50, 0.30],
      [0.47, 0.28], [0.53, 0.28],
      [0.44, 0.29], [0.56, 0.29],
      [0.40, 0.40], [0.60, 0.38],
      [0.28, 0.36], [0.72, 0.34],  // arms spread wide falling
      [0.18, 0.32], [0.82, 0.30],
      [0.43, 0.58], [0.57, 0.56],
      [0.40, 0.72], [0.62, 0.68],
      [0.38, 0.86], [0.66, 0.80],
    )},
  },
  {
    id: 'cinematic-hands-clasped-down',
    name: 'Reverent Bow',
    category: 'cinematic',
    description: 'Deep forward bow — respect, defeat, or ceremony.',
    tags: ['bow', 'reverence', 'ceremony', 'defeat'],
    keyframe: { joints: j(
      [0.50, 0.32],
      [0.47, 0.30], [0.53, 0.30],
      [0.44, 0.31], [0.56, 0.31],
      [0.42, 0.42], [0.58, 0.40],
      [0.40, 0.54], [0.60, 0.52],
      [0.42, 0.64], [0.58, 0.62],
      [0.43, 0.68], [0.57, 0.66],
      [0.42, 0.82], [0.58, 0.82],
      [0.42, 0.96], [0.58, 0.96],
    )},
  },
  {
    id: 'cinematic-back-wall',
    name: 'Against the Wall',
    category: 'cinematic',
    description: 'Pressed against a wall — tense or hiding.',
    tags: ['wall', 'tense', 'hiding', 'suspense'],
    keyframe: { joints: j(
      [0.50, 0.09],
      [0.47, 0.07], [0.53, 0.07],
      [0.44, 0.08], [0.56, 0.08],
      [0.43, 0.21], [0.59, 0.20],
      [0.42, 0.36], [0.62, 0.32],
      [0.42, 0.50], [0.64, 0.24],  // one arm up against wall
      [0.44, 0.54], [0.57, 0.54],
      [0.44, 0.72], [0.57, 0.72],
      [0.44, 0.92], [0.58, 0.92],
    )},
  },
  {
    id: 'cinematic-embrace',
    name: 'Embrace (Lead)',
    category: 'cinematic',
    description: 'Arms wrapping around — the giving side of a hug.',
    tags: ['hug', 'embrace', 'comfort', 'love'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.40, 0.20], [0.58, 0.20],
      [0.46, 0.32], [0.62, 0.28],
      [0.52, 0.42], [0.56, 0.24],  // arms wrapping forward
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'cinematic-reaching-out',
    name: 'Reaching Out',
    category: 'cinematic',
    description: 'Desperate reach forward — separation or rescue.',
    tags: ['reach', 'desperate', 'rescue', 'separation'],
    keyframe: { joints: j(
      [0.54, 0.10],
      [0.51, 0.08], [0.57, 0.08],
      [0.48, 0.09], [0.60, 0.09],
      [0.44, 0.22], [0.62, 0.20],
      [0.40, 0.32], [0.74, 0.22],
      [0.36, 0.42], [0.86, 0.18],  // right arm fully reaching
      [0.46, 0.54], [0.58, 0.52],
      [0.44, 0.72], [0.58, 0.72],
      [0.43, 0.92], [0.58, 0.92],
    )},
  },
  {
    id: 'cinematic-monologue',
    name: 'Monologue Stance',
    category: 'cinematic',
    description: 'One hand on chest, one extended — passionate speech.',
    tags: ['speech', 'monologue', 'passion', 'drama'],
    keyframe: { joints: j(
      [0.50, 0.08],
      [0.47, 0.06], [0.53, 0.06],
      [0.44, 0.07], [0.56, 0.07],
      [0.42, 0.20], [0.58, 0.20],
      [0.44, 0.32], [0.66, 0.24],
      [0.46, 0.24], [0.78, 0.18],  // right arm extended outward
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'cinematic-look-up',
    name: 'Looking Up',
    category: 'cinematic',
    description: 'Head tilted skyward — awe, hope, or rain shot.',
    tags: ['look up', 'sky', 'awe', 'hope'],
    keyframe: { joints: j(
      [0.50, 0.06],   // nose raised
      [0.47, 0.04], [0.53, 0.04],
      [0.44, 0.05], [0.56, 0.05],
      [0.42, 0.20], [0.58, 0.20],
      [0.40, 0.36], [0.60, 0.36],
      [0.38, 0.51], [0.62, 0.51],
      [0.44, 0.52], [0.56, 0.52],
      [0.44, 0.70], [0.56, 0.70],
      [0.44, 0.90], [0.56, 0.90],
    )},
  },
  {
    id: 'cinematic-lean-doorway',
    name: 'Leaning in Doorway',
    category: 'cinematic',
    description: 'One arm raised against frame — cool, relaxed authority.',
    tags: ['doorway', 'lean', 'cool', 'authority'],
    keyframe: { joints: j(
      [0.50, 0.09],
      [0.47, 0.07], [0.53, 0.07],
      [0.44, 0.08], [0.56, 0.08],
      [0.43, 0.21], [0.60, 0.20],
      [0.40, 0.35], [0.68, 0.12],  // right arm up against frame
      [0.38, 0.50], [0.72, 0.04],
      [0.44, 0.54], [0.58, 0.54],
      [0.44, 0.72], [0.58, 0.72],
      [0.44, 0.92], [0.59, 0.92],
    )},
  },
];

/** Find poses matching a text query. Returns at most `limit` results. */
export function searchPoses(query: string, limit = 12): PoseTemplate[] {
  const q = query.toLowerCase().trim();
  if (!q) return POSE_VOCABULARY.slice(0, limit);
  return POSE_VOCABULARY.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.tags.some((t) => t.includes(q))
  ).slice(0, limit);
}

/** Skeleton connections for SVG rendering (pairs of joint indices). */
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Head
  [0, 1], [0, 2],   // nose → eyes
  [1, 3], [2, 4],   // eyes → ears
  // Torso
  [5, 6],           // shoulders
  [5, 11], [6, 12], // shoulders → hips
  [11, 12],         // hips
  // Left arm
  [5, 7], [7, 9],
  // Right arm
  [6, 8], [8, 10],
  // Left leg
  [11, 13], [13, 15],
  // Right leg
  [12, 14], [14, 16],
];
