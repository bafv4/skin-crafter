// 2D キャンバスの表示倍率（表示領域に収まる倍率）のテスト
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { fitScale } from './Canvas2D';

// 余白（表示領域 p-4・枠 p-2・罫線）の合計
const PADDING = 50;

describe('fitScale', () => {
  it('広い表示領域では既定の 8x（それより大きくはしない）', () => {
    expect(fitScale(1600, 1200)).toBe(8);
  });

  it('スキン（64px 四方）× 倍率 が表示領域の幅・高さの小さい方に収まる最大の整数倍率', () => {
    expect(fitScale(64 * 5 + PADDING, 2000)).toBe(5);
    expect(fitScale(2000, 64 * 3 + PADDING + 63)).toBe(3);
    // スマホ幅（ツールバーを除いた 312px）
    expect(fitScale(312, 500)).toBe(4);
  });

  it('とても小さい表示領域でも 2x より小さくはしない', () => {
    expect(fitScale(100, 100)).toBe(2);
  });
});
