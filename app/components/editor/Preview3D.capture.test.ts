// 3D プレビューの画像書き出しの解像度のテスト
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { captureScale } from './Preview3D.client';

describe('captureScale', () => {
  it('表示が小さくても、長辺が 1024px 以上になる倍率で描画する', () => {
    expect(captureScale(512, 400, 1)).toBe(2);
    expect(Math.max(364, 512) * captureScale(364, 512, 1)).toBeGreaterThanOrEqual(1024);
  });

  it('いまの画面の倍率（高解像度ディスプレイなど）がそれより大きければ、その倍率を使う', () => {
    expect(captureScale(800, 600, 2)).toBe(2);
  });

  it('とても小さい表示でも倍率は 4 までにする', () => {
    expect(captureScale(100, 80, 1)).toBe(4);
    expect(captureScale(0, 0, 1)).toBe(4);
  });
});
