// 3D プレビューのポーズ（頭・腕・脚の関節の角度）
// 角度は度で持ち、キャラクター視点の向きで表す（three.js の回転への変換は poseToRotation）

export type PosePartKey = 'head' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';

export const POSE_PART_KEYS: readonly PosePartKey[] = ['head', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

// forward: 腕・脚は前へ振る角度、頭は上を向く角度
// side: 腕・脚は外へ開く角度、頭はキャラクターの左を向く角度
export interface JointAngles {
  forward: number;
  side: number;
}

export type Pose = Record<PosePartKey, JointAngles>;

const ZERO: JointAngles = { forward: 0, side: 0 };

export function createPose(angles: Partial<Record<PosePartKey, Partial<JointAngles>>> = {}): Pose {
  return Object.fromEntries(
    POSE_PART_KEYS.map((key) => [key, { ...ZERO, ...angles[key] }])
  ) as Pose;
}

export const DEFAULT_POSE: Pose = createPose();

export function isDefaultPose(pose: Pose): boolean {
  return POSE_PART_KEYS.every((key) => pose[key].forward === 0 && pose[key].side === 0);
}

export function isSamePose(a: Pose, b: Pose): boolean {
  return POSE_PART_KEYS.every((key) => a[key].forward === b[key].forward && a[key].side === b[key].side);
}

// スライダーの範囲（度）
export const POSE_RANGES: Record<PosePartKey, { forward: [number, number]; side: [number, number] }> = {
  head: { forward: [-60, 60], side: [-90, 90] },
  rightArm: { forward: [-180, 180], side: [-20, 180] },
  leftArm: { forward: [-180, 180], side: [-20, 180] },
  rightLeg: { forward: [-90, 90], side: [-20, 60] },
  leftLeg: { forward: [-90, 90], side: [-20, 60] },
};

export const POSE_PRESETS: { id: string; label: string; pose: Pose }[] = [
  { id: 'default', label: '標準', pose: DEFAULT_POSE },
  {
    id: 'walk',
    label: '歩く',
    pose: createPose({
      rightArm: { forward: 30 },
      leftArm: { forward: -30 },
      rightLeg: { forward: -30 },
      leftLeg: { forward: 30 },
    }),
  },
  {
    id: 'run',
    label: '走る',
    pose: createPose({
      head: { forward: -10 },
      rightArm: { forward: 60, side: 5 },
      leftArm: { forward: -60, side: 5 },
      rightLeg: { forward: -50 },
      leftLeg: { forward: 50 },
    }),
  },
  {
    id: 'wave',
    label: '手を振る',
    pose: createPose({
      head: { side: -10 },
      rightArm: { side: 150 },
      leftArm: { side: 5 },
    }),
  },
  {
    id: 'tpose',
    label: 'T ポーズ',
    pose: createPose({ rightArm: { side: 90 }, leftArm: { side: 90 } }),
  },
  {
    id: 'reach',
    label: '腕を前に',
    pose: createPose({ rightArm: { forward: 90 }, leftArm: { forward: 90 } }),
  },
  {
    id: 'sit',
    label: '座る',
    pose: createPose({
      rightArm: { forward: 30 },
      leftArm: { forward: 30 },
      rightLeg: { forward: 90, side: 5 },
      leftLeg: { forward: 90, side: 5 },
    }),
  },
];

const RAD = Math.PI / 180;

// キャラクター視点の角度 → three.js のオイラー角（ラジアン、XYZ 順）。
// モデルは +Z が正面、キャラクターの左が +X（右腕・右脚は -X 側）
export function poseToRotation(part: PosePartKey, angles: JointAngles): [number, number, number] {
  // X 軸まわりに負の向きへ回すと、下に垂れた腕・脚の先は前（+Z）へ、頭の正面は上へ向く
  const x = -angles.forward * RAD;
  if (part === 'head') {
    // Y 軸まわりに正の向きへ回すと、正面が +X（キャラクターの左）を向く
    return [x, angles.side * RAD, 0];
  }
  // Z 軸まわりに正の向きへ回すと、下に垂れた先が +X へ開く。右側（-X）のパーツは逆向き
  const outward = part === 'leftArm' || part === 'leftLeg' ? 1 : -1;
  return [x, 0, outward * angles.side * RAD];
}
