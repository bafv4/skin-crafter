import { describe, expect, it, vi } from 'vitest';
import type { RGBA } from '../types/editor';
import {
  applyBrightnessNoise,
  applyHueShift,
  applyNoise,
  generateNoisePreview,
  hslToRgb,
  rgbToHsl,
} from './noiseGenerator';

// ---- テスト用ヘルパー ----

const rgba = (r: number, g: number, b: number, a = 255): RGBA => ({ r, g, b, a });

// Math.random を常に同じ値にする
function mockRandom(value: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

// Math.random を決定的な擬似乱数列に置き換える（mulberry32）
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockSeededRandom(seed: number) {
  return vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
}

// 色相の符号付き円周距離（-0.5〜0.5）
function hueDelta(from: number, to: number): number {
  let d = to - from;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

function expectValidChannel(v: number) {
  expect(Number.isInteger(v)).toBe(true);
  expect(v).toBeGreaterThanOrEqual(0);
  expect(v).toBeLessThanOrEqual(255);
}

function expectValidColor(c: RGBA) {
  expectValidChannel(c.r);
  expectValidChannel(c.g);
  expectValidChannel(c.b);
}

// 1 - 2^-53 相当（Math.random が返しうる最大値に近い値）
const ALMOST_ONE = 1 - Number.EPSILON;

describe('rgbToHsl', () => {
  it('原色・二次色を既知の HSL に変換する', () => {
    const cases: Array<[[number, number, number], [number, number, number]]> = [
      [[255, 0, 0], [0, 1, 0.5]],
      [[255, 255, 0], [1 / 6, 1, 0.5]],
      [[0, 255, 0], [1 / 3, 1, 0.5]],
      [[0, 255, 255], [1 / 2, 1, 0.5]],
      [[0, 0, 255], [2 / 3, 1, 0.5]],
      [[255, 0, 255], [5 / 6, 1, 0.5]],
    ];
    for (const [[r, g, b], [eh, es, el]] of cases) {
      const [h, s, l] = rgbToHsl(r, g, b);
      expect(h).toBeCloseTo(eh, 10);
      expect(s).toBeCloseTo(es, 10);
      expect(l).toBeCloseTo(el, 10);
    }
  });

  it('無彩色（黒・白・グレー）は色相0・彩度0になり、明度はチャンネル値/255', () => {
    expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0]);
    expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 1]);
    for (const v of [1, 64, 127, 128, 200, 254]) {
      const [h, s, l] = rgbToHsl(v, v, v);
      expect(h).toBe(0);
      expect(s).toBe(0);
      expect(l).toBeCloseTo(v / 255, 12);
    }
  });

  it('明度が 0.5 以下と 0.5 超の両方で彩度を正しく計算する', () => {
    // 暗い色: l <= 0.5 → s = d / (max + min)
    const [h1, s1, l1] = rgbToHsl(64, 32, 32);
    expect(h1).toBeCloseTo(0, 10);
    expect(l1).toBeCloseTo((64 + 32) / 2 / 255, 10);
    expect(s1).toBeCloseTo((64 - 32) / (64 + 32), 10);

    // 明るい色: l > 0.5 → s = d / (2 - max - min)
    const [h2, s2, l2] = rgbToHsl(255, 128, 128);
    expect(h2).toBeCloseTo(0, 10);
    expect(l2).toBeCloseTo((255 + 128) / 2 / 255, 10);
    expect(s2).toBeCloseTo(1, 10);
  });

  it('赤が最大で緑 < 青の場合、色相は 0〜1 の範囲に折り返される（マゼンタ寄りの赤）', () => {
    const [h, s, l] = rgbToHsl(255, 0, 128);
    // (0 - 128/255) / 1 + 6 を 6 で割った値 ≒ 330度
    expect(h).toBeCloseTo((6 - 128 / 255) / 6, 10);
    expect(h).toBeGreaterThan(0.9);
    expect(h).toBeLessThan(1);
    expect(s).toBeCloseTo(1, 10);
    expect(l).toBeCloseTo(0.5, 10);
  });

  it('出力は常に h ∈ [0, 1)、s ∈ [0, 1]、l ∈ [0, 1] に収まる', () => {
    const outOfRange: string[] = [];
    for (let r = 0; r <= 255; r += 5) {
      for (let g = 0; g <= 255; g += 5) {
        for (let b = 0; b <= 255; b += 5) {
          const [h, s, l] = rgbToHsl(r, g, b);
          if (!(h >= 0 && h < 1 && s >= 0 && s <= 1 && l >= 0 && l <= 1)) {
            outOfRange.push(`(${r},${g},${b}) -> (${h},${s},${l})`);
          }
        }
      }
    }
    expect(outOfRange).toEqual([]);
  });
});

describe('hslToRgb', () => {
  it('既知の HSL を原色・二次色に変換する', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(1 / 6, 1, 0.5)).toEqual([255, 255, 0]);
    expect(hslToRgb(1 / 3, 1, 0.5)).toEqual([0, 255, 0]);
    expect(hslToRgb(1 / 2, 1, 0.5)).toEqual([0, 255, 255]);
    expect(hslToRgb(2 / 3, 1, 0.5)).toEqual([0, 0, 255]);
    expect(hslToRgb(5 / 6, 1, 0.5)).toEqual([255, 0, 255]);
  });

  it('中間の色相も補間される（36度 = オレンジ、324度 = ピンク）', () => {
    expect(hslToRgb(0.1, 1, 0.5)).toEqual([255, 153, 0]);
    expect(hslToRgb(0.9, 1, 0.5)).toEqual([255, 0, 153]);
  });

  it('彩度0は色相に関係なくグレーになる', () => {
    for (const h of [0, 0.25, 0.5, 0.99]) {
      expect(hslToRgb(h, 0, 0)).toEqual([0, 0, 0]);
      expect(hslToRgb(h, 0, 1)).toEqual([255, 255, 255]);
      expect(hslToRgb(h, 0, 0.5)).toEqual([128, 128, 128]);
      expect(hslToRgb(h, 0, 100 / 255)).toEqual([100, 100, 100]);
    }
  });

  it('明度 0 は黒、明度 1 は白になる（彩度に関係なく）', () => {
    expect(hslToRgb(0.3, 1, 0)).toEqual([0, 0, 0]);
    expect(hslToRgb(0.3, 1, 1)).toEqual([255, 255, 255]);
    expect(hslToRgb(0.7, 0.4, 0)).toEqual([0, 0, 0]);
    expect(hslToRgb(0.7, 0.4, 1)).toEqual([255, 255, 255]);
  });

  it('出力は常に 0〜255 の整数', () => {
    for (let h = 0; h < 1; h += 0.05) {
      for (let s = 0; s <= 1; s += 0.25) {
        for (let l = 0; l <= 1; l += 0.125) {
          const [r, g, b] = hslToRgb(h, s, l);
          expectValidChannel(r);
          expectValidChannel(g);
          expectValidChannel(b);
        }
      }
    }
  });
});

describe('rgbToHsl ⇔ hslToRgb の往復変換', () => {
  it('RGB → HSL → RGB で元の色に戻る（格子状にサンプリング）', () => {
    const mismatches: string[] = [];
    for (let r = 0; r <= 255; r += 5) {
      for (let g = 0; g <= 255; g += 5) {
        for (let b = 0; b <= 255; b += 5) {
          const [h, s, l] = rgbToHsl(r, g, b);
          const [r2, g2, b2] = hslToRgb(h, s, l);
          // 1 以内の誤差を許容（実装上は完全一致する）
          if (Math.abs(r2 - r) > 1 || Math.abs(g2 - g) > 1 || Math.abs(b2 - b) > 1) {
            mismatches.push(`(${r},${g},${b}) -> (${r2},${g2},${b2})`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('境界付近の値（0, 1, 254, 255 の組み合わせ）も元の色に戻る', () => {
    const values = [0, 1, 127, 128, 254, 255];
    for (const r of values) {
      for (const g of values) {
        for (const b of values) {
          const [h, s, l] = rgbToHsl(r, g, b);
          expect(hslToRgb(h, s, l)).toEqual([r, g, b]);
        }
      }
    }
  });

  it('HSL → RGB → HSL で 8bit 量子化の誤差内に戻る', () => {
    const cases: Array<[number, number, number]> = [
      [0.05, 0.8, 0.4],
      [0.3, 0.5, 0.6],
      [0.55, 0.9, 0.3],
      [0.8, 0.6, 0.5],
      [0.95, 0.7, 0.7],
    ];
    for (const [h, s, l] of cases) {
      const [r, g, b] = hslToRgb(h, s, l);
      const [h2, s2, l2] = rgbToHsl(r, g, b);
      expect(Math.abs(hueDelta(h, h2))).toBeLessThan(0.01);
      expect(Math.abs(s2 - s)).toBeLessThan(0.02);
      expect(Math.abs(l2 - l)).toBeLessThan(0.01);
    }
  });
});

describe('applyBrightnessNoise', () => {
  it('強度 0 は入力と同じ色を返し、乱数を消費しない', () => {
    const random = mockRandom(0);
    const color = rgba(10, 20, 30, 40);
    expect(applyBrightnessNoise(color, 0)).toEqual(rgba(10, 20, 30, 40));
    expect(random).not.toHaveBeenCalled();
  });

  it('乱数 0.5 のときは変化しない', () => {
    mockRandom(0.5);
    expect(applyBrightnessNoise(rgba(100, 150, 200), 100)).toEqual(rgba(100, 150, 200));
  });

  it('乱数が 0.5 未満なら暗く、0.5 超なら明るくなる（全チャンネルに同じ量を加算）', () => {
    const color = rgba(100, 120, 140);

    mockRandom(0.25);
    // 強度100 → 最大±50、(0.25 - 0.5) * 2 * 50 = -25
    expect(applyBrightnessNoise(color, 100)).toEqual(rgba(75, 95, 115));

    mockRandom(0.75);
    expect(applyBrightnessNoise(color, 100)).toEqual(rgba(125, 145, 165));
  });

  it('変化量は強度に比例する（最大 ±強度/2）', () => {
    const color = rgba(128, 128, 128);
    mockRandom(0);
    expect(applyBrightnessNoise(color, 100)).toEqual(rgba(78, 78, 78));
    expect(applyBrightnessNoise(color, 50)).toEqual(rgba(103, 103, 103));
    expect(applyBrightnessNoise(color, 10)).toEqual(rgba(123, 123, 123));

    mockRandom(ALMOST_ONE);
    expect(applyBrightnessNoise(color, 100)).toEqual(rgba(178, 178, 178));
    expect(applyBrightnessNoise(color, 50)).toEqual(rgba(153, 153, 153));
    expect(applyBrightnessNoise(color, 10)).toEqual(rgba(133, 133, 133));
  });

  it('結果は整数に丸められる', () => {
    // 強度10 → 最大±5、(0.62 - 0.5) * 2 * 5 = 1.2 → 四捨五入で +1
    mockRandom(0.62);
    const result = applyBrightnessNoise(rgba(100, 100, 100), 10);
    expect(result).toEqual(rgba(101, 101, 101));
  });

  it('上限 255 と下限 0 にクランプされる', () => {
    const color = rgba(250, 5, 128);

    mockRandom(ALMOST_ONE);
    expect(applyBrightnessNoise(color, 100)).toEqual(rgba(255, 55, 178));

    mockRandom(0);
    expect(applyBrightnessNoise(color, 100)).toEqual(rgba(200, 0, 78));
  });

  it('強度が 100 を超えてもクランプされる', () => {
    mockRandom(ALMOST_ONE);
    expect(applyBrightnessNoise(rgba(10, 128, 250), 1000)).toEqual(rgba(255, 255, 255));
    mockRandom(0);
    expect(applyBrightnessNoise(rgba(10, 128, 250), 1000)).toEqual(rgba(0, 0, 0));
  });

  it('アルファ値は保持される', () => {
    mockRandom(ALMOST_ONE);
    for (const a of [0, 1, 128, 255]) {
      expect(applyBrightnessNoise(rgba(100, 100, 100, a), 100).a).toBe(a);
    }
  });

  it('入力の色オブジェクトを変更しない', () => {
    mockRandom(0);
    const color = rgba(100, 100, 100, 200);
    applyBrightnessNoise(color, 100);
    expect(color).toEqual(rgba(100, 100, 100, 200));
  });

  it('多数の乱数に対して、出力は常に 0〜255 の整数で、変化量は ±強度/2 以内', () => {
    mockSeededRandom(12345);
    const colors = [rgba(0, 0, 0), rgba(255, 255, 255), rgba(3, 128, 252), rgba(60, 200, 90, 17)];
    for (const intensity of [1, 10, 33, 50, 100]) {
      const maxVariation = intensity / 2;
      for (const color of colors) {
        for (let i = 0; i < 50; i++) {
          const out = applyBrightnessNoise(color, intensity);
          expectValidColor(out);
          expect(out.a).toBe(color.a);
          for (const key of ['r', 'g', 'b'] as const) {
            // 丸めの 0.5 を許容
            expect(Math.abs(out[key] - color[key])).toBeLessThanOrEqual(maxVariation + 0.5);
          }
          // 全チャンネルが同じ方向に動く（クランプを除く）
          const deltas = (['r', 'g', 'b'] as const).map((k) => Math.sign(out[k] - color[k]));
          const nonZero = deltas.filter((d) => d !== 0);
          expect(new Set(nonZero).size).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('applyHueShift', () => {
  it('強度 0 は入力と同じ色を返し、乱数を消費しない', () => {
    const random = mockRandom(0);
    const color = rgba(200, 50, 10, 99);
    expect(applyHueShift(color, 0)).toEqual(rgba(200, 50, 10, 99));
    expect(random).not.toHaveBeenCalled();
  });

  it('乱数 0.5（シフト量0）では色が変わらない', () => {
    mockRandom(0.5);
    for (const color of [rgba(255, 0, 0), rgba(12, 200, 99), rgba(250, 250, 5), rgba(1, 2, 3)]) {
      expect(applyHueShift(color, 100)).toEqual(color);
    }
  });

  it('乱数が 0.5 超なら色相が増え、0.5 未満なら減る（強度100で最大 ±0.1 = 36度）', () => {
    const red = rgba(255, 0, 0);

    mockRandom(ALMOST_ONE);
    // 赤(0度) → 36度（オレンジ）
    expect(applyHueShift(red, 100)).toEqual(rgba(255, 153, 0));

    mockRandom(0);
    // 赤(0度) → -36度 = 324度（ピンク）へ折り返す
    expect(applyHueShift(red, 100)).toEqual(rgba(255, 0, 153));
  });

  it('シフト量は強度に比例する', () => {
    const color = rgba(40, 200, 120); // 緑寄りの色
    const [h0] = rgbToHsl(color.r, color.g, color.b);

    for (const [intensity, random, expectedShift] of [
      [100, 0.75, 0.05],
      [50, 0.75, 0.025],
      [100, 0.25, -0.05],
      [50, 0, -0.05],
      [20, ALMOST_ONE, 0.02],
    ] as const) {
      mockRandom(random);
      const out = applyHueShift(color, intensity);
      const [h1] = rgbToHsl(out.r, out.g, out.b);
      // 8bit 量子化による誤差を許容
      expect(Math.abs(hueDelta(h0, h1) - expectedShift)).toBeLessThan(0.005);
    }
  });

  it('色相が 1 付近で正方向にシフトすると 0 側に折り返す', () => {
    const color = rgba(255, 0, 26); // 色相 ≒ 354度
    const [h0] = rgbToHsl(color.r, color.g, color.b);
    expect(h0).toBeGreaterThan(0.95);

    mockRandom(ALMOST_ONE);
    const out = applyHueShift(color, 100);
    const [h1] = rgbToHsl(out.r, out.g, out.b);
    expect(h1).toBeLessThan(0.1);
    expect(Math.abs(hueDelta(h0, h1) - 0.1)).toBeLessThan(0.005);
    // 赤が最大、緑 > 青 の暖色側に移る
    expect(out.r).toBe(255);
    expect(out.g).toBeGreaterThan(out.b);
  });

  it('無彩色（グレー・黒・白）は色相シフトの影響を受けない', () => {
    for (const random of [0, 0.3, ALMOST_ONE]) {
      mockRandom(random);
      for (const v of [0, 1, 77, 128, 254, 255]) {
        expect(applyHueShift(rgba(v, v, v, 42), 100)).toEqual(rgba(v, v, v, 42));
      }
    }
  });

  it('アルファ値は保持される', () => {
    mockRandom(0.1);
    for (const a of [0, 1, 128, 255]) {
      expect(applyHueShift(rgba(200, 50, 50, a), 100).a).toBe(a);
    }
  });

  it('入力の色オブジェクトを変更しない', () => {
    mockRandom(ALMOST_ONE);
    const color = rgba(200, 50, 50, 128);
    applyHueShift(color, 100);
    expect(color).toEqual(rgba(200, 50, 50, 128));
  });

  it('多数の乱数に対して、出力は 0〜255 の整数で、彩度・明度はほぼ保たれ、色相変化は ±0.1×強度/100 以内', () => {
    mockSeededRandom(98765);
    const colors = [rgba(255, 0, 0), rgba(30, 60, 200), rgba(250, 240, 10), rgba(90, 180, 120, 3)];
    for (const intensity of [5, 25, 50, 100]) {
      const maxShift = (intensity / 100) * 0.1;
      for (const color of colors) {
        const [h0, s0, l0] = rgbToHsl(color.r, color.g, color.b);
        for (let i = 0; i < 40; i++) {
          const out = applyHueShift(color, intensity);
          expectValidColor(out);
          expect(out.a).toBe(color.a);
          const [h1, s1, l1] = rgbToHsl(out.r, out.g, out.b);
          expect(Math.abs(hueDelta(h0, h1))).toBeLessThanOrEqual(maxShift + 0.01);
          expect(Math.abs(l1 - l0)).toBeLessThan(0.01);
          expect(Math.abs(s1 - s0)).toBeLessThan(0.05);
        }
      }
    }
  });
});

describe('applyNoise', () => {
  it('両方の強度が 0 なら入力と等しい色を返し、乱数を消費しない', () => {
    const random = mockRandom(0);
    const color = rgba(12, 34, 56, 78);
    const result = applyNoise(color, 0, 0);
    expect(result).toEqual(color);
    expect(random).not.toHaveBeenCalled();
  });

  it('両方の強度が 0 でも返り値を変更して入力に影響しない（コピーを返す）', () => {
    const color = rgba(12, 34, 56, 78);
    const result = applyNoise(color, 0, 0);
    result.r = 99;
    expect(color.r).toBe(12);
  });

  it('負の強度はノイズなしとして扱う', () => {
    const random = mockRandom(0);
    const color = rgba(100, 150, 200, 255);
    expect(applyNoise(color, -50, -50)).toEqual(color);
    expect(random).not.toHaveBeenCalled();
  });

  it('明るさのみ指定した場合は applyBrightnessNoise と同じ結果', () => {
    mockRandom(0.25);
    const color = rgba(200, 100, 50, 128);
    expect(applyNoise(color, 60, 0)).toEqual(applyBrightnessNoise(color, 60));
    // 強度60 → 最大±30、(0.25 - 0.5) * 2 * 30 = -15
    expect(applyNoise(color, 60, 0)).toEqual(rgba(185, 85, 35, 128));
  });

  it('色相のみ指定した場合は applyHueShift と同じ結果', () => {
    mockRandom(ALMOST_ONE);
    const red = rgba(255, 0, 0, 7);
    expect(applyNoise(red, 0, 100)).toEqual(rgba(255, 153, 0, 7));
  });

  it('両方指定した場合は 明るさ → 色相 の順に適用する', () => {
    const color = rgba(240, 60, 30, 200);
    const randoms = [0.9, 0.2];

    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(randoms[0])
      .mockReturnValueOnce(randoms[1]);
    const result = applyNoise(color, 80, 70);

    vi.spyOn(Math, 'random').mockReturnValueOnce(randoms[0]).mockReturnValueOnce(randoms[1]);
    const expected = applyHueShift(applyBrightnessNoise(color, 80), 70);

    expect(result).toEqual(expected);
    expect(result.a).toBe(200);
    expectValidColor(result);
  });

  it('グレーに両方のノイズをかけると明るさだけが変わる', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.75).mockReturnValueOnce(0.1);
    // 強度100 → +25、グレーは色相シフトの影響を受けない
    expect(applyNoise(rgba(100, 100, 100, 50), 100, 100)).toEqual(rgba(125, 125, 125, 50));
  });

  it('入力の色オブジェクトを変更しない', () => {
    mockRandom(0);
    const color = rgba(200, 50, 50, 128);
    applyNoise(color, 100, 100);
    expect(color).toEqual(rgba(200, 50, 50, 128));
  });

  it('出力は常に 0〜255 の整数で、アルファは保持される', () => {
    mockSeededRandom(2024);
    const colors = [rgba(0, 0, 0, 0), rgba(255, 255, 255, 255), rgba(250, 5, 128, 64), rgba(10, 240, 30, 1)];
    for (const color of colors) {
      for (let i = 0; i < 100; i++) {
        const out = applyNoise(color, 100, 100);
        expectValidColor(out);
        expect(out.a).toBe(color.a);
      }
    }
  });
});

describe('generateNoisePreview', () => {
  it('デフォルトでは 16 個のサンプルを返す', () => {
    mockSeededRandom(1);
    const samples = generateNoisePreview(rgba(100, 100, 100), 50, 50);
    expect(samples).toHaveLength(16);
  });

  it('サンプル数を指定できる（0 なら空配列）', () => {
    mockSeededRandom(1);
    expect(generateNoisePreview(rgba(100, 100, 100), 50, 50, 5)).toHaveLength(5);
    expect(generateNoisePreview(rgba(100, 100, 100), 50, 50, 1)).toHaveLength(1);
    expect(generateNoisePreview(rgba(100, 100, 100), 50, 50, 0)).toEqual([]);
  });

  it('強度 0 ならすべてのサンプルがベース色と等しい', () => {
    const base = rgba(10, 20, 30, 40);
    const samples = generateNoisePreview(base, 0, 0, 8);
    expect(samples).toHaveLength(8);
    for (const s of samples) {
      expect(s).toEqual(base);
    }
  });

  it('各サンプルは独立した乱数で生成される', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.75);
    const samples = generateNoisePreview(rgba(100, 100, 100, 255), 100, 0, 4);
    expect(samples).toEqual([
      rgba(50, 50, 50),
      rgba(75, 75, 75),
      rgba(100, 100, 100),
      rgba(125, 125, 125),
    ]);
  });

  it('各サンプルは applyNoise を順に呼んだ結果と一致する', () => {
    const base = rgba(180, 90, 40, 222);

    mockSeededRandom(777);
    const samples = generateNoisePreview(base, 70, 40, 10);

    mockSeededRandom(777);
    const expected = Array.from({ length: 10 }, () => applyNoise(base, 70, 40));

    expect(samples).toEqual(expected);
  });

  it('サンプルは別々のオブジェクトで、ベース色を変更しない', () => {
    const base = rgba(100, 100, 100, 255);
    const samples = generateNoisePreview(base, 0, 0, 3);
    samples[0].r = 1;
    expect(samples[1].r).toBe(100);
    expect(samples[2].r).toBe(100);
    expect(base).toEqual(rgba(100, 100, 100, 255));
  });

  it('すべてのサンプルは有効な色で、アルファはベース色のまま', () => {
    mockSeededRandom(4242);
    const samples = generateNoisePreview(rgba(250, 10, 128, 77), 100, 100, 64);
    for (const s of samples) {
      expectValidColor(s);
      expect(s.a).toBe(77);
    }
  });
});
