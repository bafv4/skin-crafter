// ポーズの角度 → three.js の回転の変換のテスト
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_POSE,
  POSE_PART_KEYS,
  POSE_PRESETS,
  POSE_RANGES,
  createPose,
  isDefaultPose,
  isSamePose,
  poseToRotation,
  type PosePartKey,
} from './pose';

// 関節を中心に、点を回転させたあとの位置
function rotate(part: PosePartKey, forward: number, side: number, point: [number, number, number]) {
  const [x, y, z] = poseToRotation(part, { forward, side });
  return new THREE.Vector3(...point).applyEuler(new THREE.Euler(x, y, z));
}

const DOWN: [number, number, number] = [0, -1, 0]; // 下に垂れた腕・足の先
const FRONT: [number, number, number] = [0, 0, 1]; // 頭の正面

describe('poseToRotation', () => {
  it.each(['rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const)('%s: 前へ 90° 振ると先が正面（+Z）を向く', (part) => {
    const tip = rotate(part, 90, 0, DOWN);
    expect(tip.z).toBeCloseTo(1);
    expect(tip.y).toBeCloseTo(0);
  });

  it('横へ開くと、左腕・左足は +X（キャラクターの左）、右腕・右足は -X へ開く', () => {
    expect(rotate('leftArm', 0, 90, DOWN).x).toBeCloseTo(1);
    expect(rotate('leftLeg', 0, 90, DOWN).x).toBeCloseTo(1);
    expect(rotate('rightArm', 0, 90, DOWN).x).toBeCloseTo(-1);
    expect(rotate('rightLeg', 0, 90, DOWN).x).toBeCloseTo(-1);
  });

  it('頭は forward で上を、side でキャラクターの左（+X）を向く', () => {
    expect(rotate('head', 30, 0, FRONT).y).toBeGreaterThan(0.4);
    expect(rotate('head', 0, 90, FRONT).x).toBeCloseTo(1);
  });

  it('角度 0 なら回転しない', () => {
    for (const part of POSE_PART_KEYS) {
      expect(poseToRotation(part, { forward: 0, side: 0 }).map((v) => Math.abs(v))).toEqual([0, 0, 0]);
    }
  });
});

describe('プリセット', () => {
  it('ID が重複せず、すべての角度がスライダーの範囲内', () => {
    expect(new Set(POSE_PRESETS.map((p) => p.id)).size).toBe(POSE_PRESETS.length);
    for (const { pose } of POSE_PRESETS) {
      for (const part of POSE_PART_KEYS) {
        for (const axis of ['forward', 'side'] as const) {
          const [min, max] = POSE_RANGES[part][axis];
          expect(pose[part][axis]).toBeGreaterThanOrEqual(min);
          expect(pose[part][axis]).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it('標準以外のプリセットはどれも標準と異なり、互いにも異なる', () => {
    const others = POSE_PRESETS.filter((p) => p.id !== 'default');
    expect(others.every((p) => !isDefaultPose(p.pose))).toBe(true);
    for (let i = 0; i < others.length; i++) {
      for (let j = i + 1; j < others.length; j++) {
        expect(isSamePose(others[i].pose, others[j].pose)).toBe(false);
      }
    }
  });

  it('createPose は指定のない角度を 0 にする', () => {
    expect(createPose({ head: { side: 10 } }).head).toEqual({ forward: 0, side: 10 });
    expect(isDefaultPose(DEFAULT_POSE)).toBe(true);
  });
});
