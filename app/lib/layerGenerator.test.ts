import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  COLOR_THRESHOLD_PRESETS,
  areColorsSimilar,
  blendBorderPixels,
  colorDistance,
  generateLayersFromImageData,
  mergeLayers,
  mergeSimilarLayers,
  splitLayerByColor,
  splitLayerBySelection,
} from './layerGenerator';
import {
  type Layer,
  type LayerPixels,
  type RGBA,
  type SkinRegion,
  SKIN_HEIGHT,
  SKIN_PARTS,
  SKIN_WIDTH,
} from '../types/editor';

// ---- テスト用ヘルパー ----

const rgba = (r: number, g: number, b: number, a = 255): RGBA => ({ r, g, b, a });

const RED = rgba(200, 30, 30);
const BLUE = rgba(30, 30, 200);
const GREEN = rgba(30, 200, 30);

// ImageData 互換オブジェクト（node 環境には ImageData がないため）
function createImage(width = SKIN_WIDTH, height = SKIN_HEIGHT): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}

function setImagePixel(image: ImageData, x: number, y: number, color: RGBA): void {
  const i = (y * image.width + x) * 4;
  image.data[i] = color.r;
  image.data[i + 1] = color.g;
  image.data[i + 2] = color.b;
  image.data[i + 3] = color.a;
}

function fillImageRect(
  image: ImageData,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: RGBA | ((x: number, y: number) => RGBA)
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setImagePixel(image, x, y, typeof color === 'function' ? color(x, y) : color);
    }
  }
}

// 指定座標の色を並べた画像（それ以外は透明）
function imageWith(entries: Array<[x: number, y: number, color: RGBA]>): ImageData {
  const image = createImage();
  for (const [x, y, color] of entries) setImagePixel(image, x, y, color);
  return image;
}

function emptyPixels(): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () =>
    Array.from({ length: SKIN_WIDTH }, () => null as RGBA | null)
  );
}

function pixelsWith(entries: Array<[x: number, y: number, color: RGBA]>): LayerPixels {
  const pixels = emptyPixels();
  for (const [x, y, color] of entries) pixels[y][x] = { ...color };
  return pixels;
}

function makeLayer(overrides: Partial<Layer> & { id: string }): Layer {
  return {
    name: overrides.id,
    baseColor: rgba(0, 0, 0),
    noiseSettings: { brightness: 0, hue: 0 },
    groupId: null,
    order: 0,
    layerType: 'direct',
    visible: true,
    opacity: 100,
    pixels: emptyPixels(),
    ...overrides,
  };
}

// レイヤー内の不透明ピクセル（null でも a=0 でもないもの）を "x,y" の集合で返す
function opaqueKeys(layer: Layer): Set<string> {
  const keys = new Set<string>();
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const p = layer.pixels[y][x];
      if (p && p.a > 0) keys.add(`${x},${y}`);
    }
  }
  return keys;
}

function keysOf(coords: Array<[number, number]>): Set<string> {
  return new Set(coords.map(([x, y]) => `${x},${y}`));
}

// 指定座標にピクセルを持つレイヤーを返す（ちょうど 1 枚であることも検証する）
function layerAt(layers: Layer[], x: number, y: number): Layer {
  const found = layers.filter((l) => {
    const p = l.pixels[y][x];
    return p !== null && p.a > 0;
  });
  expect(found, `(${x},${y}) を持つレイヤーはちょうど 1 枚のはず`).toHaveLength(1);
  return found[0];
}

// SKIN_PARTS の領域名 → 体の部位名（レイヤー2 はベース部位にマッピング）
const OVERLAY_TO_BASE: Record<string, string> = {
  hat: 'head',
  jacket: 'body',
  'right-sleeve': 'right-arm',
  'left-sleeve': 'left-arm',
  'right-pants': 'right-leg',
  'left-pants': 'left-leg',
};

function bodyPartOf(region: SkinRegion): string {
  const prefix = region.name.split('-').slice(0, -1).join('-');
  return region.layer === 2 ? OVERLAY_TO_BASE[prefix] : prefix;
}

// "head-L1" のような「部位＋スキンレイヤー」のキー
function bodyPartKey(region: SkinRegion): string {
  return `${bodyPartOf(region)}-L${region.layer}`;
}

function regionAt(x: number, y: number): SkinRegion | undefined {
  return SKIN_PARTS.find(
    (p) => x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height
  );
}

// 決定的な擬似乱数（線形合同法）
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

beforeEach(() => {
  // generateId() は Math.random を使うため、連番で決定的かつ一意な ID にする
  let n = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => (++n) / 1_000_003);
});

// ---- colorDistance / areColorsSimilar ----

describe('colorDistance', () => {
  it('同じ色の距離は 0', () => {
    expect(colorDistance(RED, { ...RED })).toBe(0);
  });

  it('RGB 空間のユークリッド距離を返す（3-4-5 の直角三角形）', () => {
    expect(colorDistance(rgba(0, 0, 0), rgba(3, 4, 0))).toBe(5);
    expect(colorDistance(rgba(10, 20, 30), rgba(10, 20, 30 + 12))).toBe(12);
  });

  it('引数の順序に依存しない（対称）', () => {
    const a = rgba(12, 200, 99);
    const b = rgba(250, 3, 40);
    expect(colorDistance(a, b)).toBe(colorDistance(b, a));
  });

  it('アルファ値は距離に影響しない', () => {
    expect(colorDistance(rgba(50, 60, 70, 255), rgba(50, 60, 70, 0))).toBe(0);
  });

  it('黒と白の距離は最大値 √3×255（約 441）', () => {
    const d = colorDistance(rgba(0, 0, 0), rgba(255, 255, 255));
    expect(d).toBeCloseTo(Math.sqrt(3) * 255, 10);
    expect(Math.floor(d)).toBe(441);
  });
});

describe('areColorsSimilar', () => {
  it('しきい値ちょうどの距離は「類似」と判定する（境界を含む）', () => {
    expect(areColorsSimilar(rgba(0, 0, 0), rgba(30, 0, 0), 30)).toBe(true);
    expect(areColorsSimilar(rgba(0, 0, 0), rgba(31, 0, 0), 30)).toBe(false);
  });

  it('しきい値を省略すると normal プリセット（30）が使われる', () => {
    expect(areColorsSimilar(rgba(0, 0, 0), rgba(COLOR_THRESHOLD_PRESETS.normal, 0, 0))).toBe(true);
    expect(areColorsSimilar(rgba(0, 0, 0), rgba(COLOR_THRESHOLD_PRESETS.normal + 1, 0, 0))).toBe(false);
  });

  it('しきい値 0 では完全一致のみ類似と判定する', () => {
    expect(areColorsSimilar(RED, { ...RED }, 0)).toBe(true);
    expect(areColorsSimilar(RED, { ...RED, b: RED.b + 1 }, 0)).toBe(false);
  });

  it('アルファだけが違う色は類似と判定する', () => {
    expect(areColorsSimilar(rgba(1, 2, 3, 255), rgba(1, 2, 3, 10), 0)).toBe(true);
  });
});

describe('COLOR_THRESHOLD_PRESETS', () => {
  it('各プリセットの値', () => {
    expect(COLOR_THRESHOLD_PRESETS).toEqual({
      strict: 15,
      normal: 30,
      loose: 50,
      veryLoose: 80,
    });
  });

  it('strict < normal < loose < veryLoose の順に緩くなり、最大距離を超えない', () => {
    const { strict, normal, loose, veryLoose } = COLOR_THRESHOLD_PRESETS;
    expect(strict).toBeLessThan(normal);
    expect(normal).toBeLessThan(loose);
    expect(loose).toBeLessThan(veryLoose);
    expect(veryLoose).toBeLessThanOrEqual(Math.sqrt(3) * 255);
  });
});

// ---- generateLayersFromImageData ----

describe('generateLayersFromImageData', () => {
  describe('基本動作', () => {
    it('全面透明の画像からはレイヤーを生成しない', () => {
      expect(generateLayersFromImageData(createImage()).layers).toEqual([]);
    });

    it('単色で塗られた 1 面は 1 枚のレイヤーになり、既定のプロパティが設定される', () => {
      const image = createImage();
      // head-front (8,8) 8x8
      fillImageRect(image, 8, 8, 8, 8, RED);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      const [layer] = layers;
      expect(layer).toMatchObject({
        name: 'head-1',
        baseColor: RED,
        groupId: null,
        order: 0,
        layerType: 'singleColor',
        visible: true,
        opacity: 100,
      });
      expect(typeof layer.id).toBe('string');
      expect(layer.id.length).toBeGreaterThan(0);

      const expected: Array<[number, number]> = [];
      for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) expected.push([x, y]);
      expect(opaqueKeys(layer)).toEqual(keysOf(expected));
    });

    it('レイヤーのピクセルデータは 64x64 で、元画像の色（アルファ含む）をそのまま保持する', () => {
      const c1 = rgba(100, 101, 102, 128);
      const c2 = rgba(104, 99, 100, 1);
      const image = imageWith([
        [10, 10, c1],
        [11, 10, c2],
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      const { pixels } = layers[0];
      expect(pixels).toHaveLength(SKIN_HEIGHT);
      for (const row of pixels) expect(row).toHaveLength(SKIN_WIDTH);
      expect(pixels[10][10]).toEqual(c1);
      expect(pixels[10][11]).toEqual(c2);
      expect(pixels[10][12]).toBeNull();
    });

    it('基本色は含まれるピクセルの平均色（四捨五入）で、アルファは 255', () => {
      const image = imageWith([
        [10, 10, rgba(100, 100, 100, 50)],
        [11, 10, rgba(101, 110, 103, 200)],
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      // (100+101)/2 = 100.5 → 101, (100+110)/2 = 105, (100+103)/2 = 101.5 → 102
      expect(layers[0].baseColor).toEqual(rgba(101, 105, 102, 255));
    });

    it('アルファ 0 のピクセルは無視し、アルファ 1 以上は取り込む', () => {
      const image = imageWith([
        [10, 10, rgba(200, 0, 0, 0)],
        [12, 12, rgba(0, 200, 0, 1)],
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      expect(opaqueKeys(layers[0])).toEqual(keysOf([[12, 12]]));
      expect(layers[0].pixels[10][10]).toBeNull();
    });

    it('レイヤーの order は 0 からの連番で、名前の末尾は 1 からの連番になる', () => {
      const image = imageWith([
        [10, 10, RED],
        [12, 12, BLUE],
        [44, 25, GREEN], // right-arm-front
        [42, 10, RED], // hat-front
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(4);
      layers.forEach((layer, i) => {
        expect(layer.order).toBe(i);
        expect(layer.name).toMatch(new RegExp(`-${i + 1}$`));
      });
      expect(new Set(layers.map((l) => l.id)).size).toBe(4);
    });

    it('レイヤー名は体の部位名から付けられ、オーバーレイ（レイヤー2）には -overlay が付く', () => {
      const image = imageWith([
        [10, 10, RED], // head-front
        [42, 10, RED], // hat-front
        [22, 25, RED], // body-front
        [22, 40, RED], // jacket-front
        [45, 25, RED], // right-arm-front
        [37, 55, RED], // left-arm-front
        [5, 25, RED], // right-leg-front
        [21, 55, RED], // left-leg-front
        [45, 40, RED], // right-sleeve-front
        [53, 55, RED], // left-sleeve-front
        [5, 40, RED], // right-pants-front
        [5, 55, RED], // left-pants-front
      ]);

      const { layers } = generateLayersFromImageData(image);
      const nameAt = (x: number, y: number) => layerAt(layers, x, y).name.replace(/-\d+$/, '');

      expect(nameAt(10, 10)).toBe('head');
      expect(nameAt(42, 10)).toBe('head-overlay');
      expect(nameAt(22, 25)).toBe('body');
      expect(nameAt(22, 40)).toBe('body-overlay');
      expect(nameAt(45, 25)).toBe('right-arm');
      expect(nameAt(37, 55)).toBe('left-arm');
      expect(nameAt(5, 25)).toBe('right-leg');
      expect(nameAt(21, 55)).toBe('left-leg');
      expect(nameAt(45, 40)).toBe('right-arm-overlay');
      expect(nameAt(53, 55)).toBe('left-arm-overlay');
      expect(nameAt(5, 40)).toBe('right-leg-overlay');
      expect(nameAt(5, 55)).toBe('left-leg-overlay');
    });

    it('どの部位にも属さない領域のピクセルも失わず、unknown レイヤーとして扱う', () => {
      // (0,0)〜(7,7) はスキン UV で未使用の領域
      const image = imageWith([
        [0, 0, RED],
        [1, 0, RED],
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe('unknown-1');
      expect(opaqueKeys(layers[0])).toEqual(keysOf([[0, 0], [1, 0]]));
    });
  });

  describe('色の類似度によるグループ化', () => {
    it('しきい値以内の似た色で隣接するピクセルは同じレイヤーになる', () => {
      // 距離 √300 ≈ 17.3
      const image = imageWith([
        [10, 10, rgba(100, 100, 100)],
        [11, 10, rgba(110, 110, 110)],
      ]);

      const { layers } = generateLayersFromImageData(image, COLOR_THRESHOLD_PRESETS.normal);

      expect(layers).toHaveLength(1);
      expect(layers[0].baseColor).toEqual(rgba(105, 105, 105));
    });

    it('しきい値を超える色の差があると隣接していても別レイヤーになる', () => {
      const image = imageWith([
        [10, 10, rgba(100, 100, 100)],
        [11, 10, rgba(110, 110, 110)],
      ]);

      const { layers } = generateLayersFromImageData(image, COLOR_THRESHOLD_PRESETS.strict);

      expect(layers).toHaveLength(2);
      expect(layerAt(layers, 10, 10).baseColor).toEqual(rgba(100, 100, 100));
      expect(layerAt(layers, 11, 10).baseColor).toEqual(rgba(110, 110, 110));
    });

    it('しきい値ちょうどの色差はグループ化される（境界を含む）', () => {
      const image = imageWith([
        [10, 10, rgba(0, 0, 0)],
        [11, 10, rgba(30, 0, 0)],
      ]);
      expect(generateLayersFromImageData(image, 30).layers).toHaveLength(1);
      expect(generateLayersFromImageData(image, 29).layers).toHaveLength(2);
    });

    it('しきい値を省略すると normal（30）が使われる', () => {
      const within = imageWith([
        [10, 10, rgba(0, 0, 0)],
        [11, 10, rgba(30, 0, 0)],
      ]);
      const beyond = imageWith([
        [10, 10, rgba(0, 0, 0)],
        [11, 10, rgba(31, 0, 0)],
      ]);
      expect(generateLayersFromImageData(within).layers).toHaveLength(1);
      expect(generateLayersFromImageData(beyond).layers).toHaveLength(2);
    });

    it('同じ色でも離れている（非隣接の）ピクセルは別レイヤーになる', () => {
      const image = imageWith([
        [10, 10, RED],
        [12, 12, RED],
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(2);
    });

    it('斜め方向（右下・左下）に隣接するピクセルも同じレイヤーになる', () => {
      const diag = imageWith([
        [10, 10, RED],
        [11, 11, RED],
      ]);
      const antiDiag = imageWith([
        [11, 10, RED],
        [10, 11, RED],
      ]);
      expect(generateLayersFromImageData(diag).layers).toHaveLength(1);
      expect(generateLayersFromImageData(antiDiag).layers).toHaveLength(1);
    });

    it('画像の左端（x=0）にある左下のピクセルとも斜めにつながる', () => {
      // head-right（x=0〜7）の内部 (1,9) と左端 (0,10)。斜め以外の経路（3D の辺を含む）ではつながらない
      const image = imageWith([
        [1, 9, RED],
        [0, 10, RED],
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      expect(opaqueKeys(layers[0])).toEqual(keysOf([[1, 9], [0, 10]]));
    });

    it('類似色は連鎖的につながる（両端の色差がしきい値を超えていても同じレイヤー）', () => {
      // 隣同士の差は 20 だが、両端の差は 60
      const image = imageWith([
        [9, 10, rgba(0, 0, 0)],
        [10, 10, rgba(20, 0, 0)],
        [11, 10, rgba(40, 0, 0)],
        [12, 10, rgba(60, 0, 0)],
      ]);

      const { layers } = generateLayersFromImageData(image, 30);

      expect(layers).toHaveLength(1);
      expect(opaqueKeys(layers[0]).size).toBe(4);
    });

    it('異なる色が隣接する場合、各ピクセルはちょうど 1 枚のレイヤーに属する', () => {
      const image = createImage();
      // head-front の左半分を赤、右半分を青
      fillImageRect(image, 8, 8, 4, 8, RED);
      fillImageRect(image, 12, 8, 4, 8, BLUE);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(2);
      const red = layerAt(layers, 8, 8);
      const blue = layerAt(layers, 15, 15);
      expect(red.baseColor).toEqual(RED);
      expect(blue.baseColor).toEqual(BLUE);
      expect(opaqueKeys(red).size).toBe(32);
      expect(opaqueKeys(blue).size).toBe(32);
      for (const key of opaqueKeys(red)) expect(opaqueKeys(blue).has(key)).toBe(false);
    });
  });

  describe('体の部位・スキンレイヤーによる分離', () => {
    it('同じ部位の隣り合う面（head-right と head-front）は同じレイヤーになる', () => {
      const image = imageWith([
        [7, 10, RED], // head-right の右端
        [8, 10, RED], // head-front の左端
      ]);
      const { layers } = generateLayersFromImageData(image);
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe('head-1');
    });

    it('2D で隣接していても異なる部位（右脚と胴体）は別レイヤーになる', () => {
      const image = imageWith([
        [15, 25, RED], // right-leg-back の右端
        [16, 25, RED], // body-right の左端
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(2);
      expect(layerAt(layers, 15, 25).name).toMatch(/^right-leg-\d+$/);
      expect(layerAt(layers, 16, 25).name).toMatch(/^body-\d+$/);
    });

    it('頭と右脚の境界（縦方向の隣接）でも別レイヤーになる', () => {
      const image = imageWith([
        [9, 15, RED], // head-front の下端
        [9, 16, RED], // right-leg-bottom の上端
        [10, 16, RED], // 斜め隣接
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(2);
      expect(layerAt(layers, 9, 15).name).toMatch(/^head-\d+$/);
      expect(layerAt(layers, 9, 16)).toBe(layerAt(layers, 10, 16));
    });

    it('同じ部位でもスキンレイヤーが異なる（head-back と hat-right）場合は別レイヤーになる', () => {
      const image = imageWith([
        [31, 10, RED], // head-back の右端（レイヤー1）
        [32, 10, RED], // hat-right の左端（レイヤー2）
      ]);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(2);
      expect(layerAt(layers, 31, 10).name).toBe('head-1');
      expect(layerAt(layers, 32, 10).name).toBe('head-overlay-2');
    });

    it('全部位を同じ色で塗ると「部位×スキンレイヤー」ごとにちょうど 1 枚ずつ（計 12 枚）になる', () => {
      const image = createImage();
      for (const part of SKIN_PARTS) {
        fillImageRect(image, part.x, part.y, part.width, part.height, RED);
      }

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(12);

      // 期待: 部位キーごとの座標集合
      const expectedByKey = new Map<string, Set<string>>();
      for (const part of SKIN_PARTS) {
        const key = bodyPartKey(part);
        if (!expectedByKey.has(key)) expectedByKey.set(key, new Set());
        for (let y = part.y; y < part.y + part.height; y++) {
          for (let x = part.x; x < part.x + part.width; x++) {
            expectedByKey.get(key)!.add(`${x},${y}`);
          }
        }
      }
      expect(expectedByKey.size).toBe(12);

      for (const layer of layers) {
        const keys = opaqueKeys(layer);
        const [first] = keys;
        const [fx, fy] = first.split(',').map(Number);
        const region = regionAt(fx, fy)!;
        expect(keys).toEqual(expectedByKey.get(bodyPartKey(region)));

        const expectedName = `${bodyPartOf(region)}${region.layer === 2 ? '-overlay' : ''}`;
        expect(layer.name.replace(/-\d+$/, '')).toBe(expectedName);
        expect(layer.baseColor).toEqual(RED);
      }
    });

    it('ノイズ入りのスキン全体でも、全ピクセルが正確な色で 1 回ずつ現れ、各レイヤーは単一の部位に収まる', () => {
      const rand = lcg(42);
      const image = createImage();
      const partColors = [RED, BLUE, GREEN, rgba(180, 160, 40), rgba(90, 40, 150), rgba(20, 20, 20)];
      SKIN_PARTS.forEach((part, i) => {
        const base = partColors[i % partColors.length];
        fillImageRect(image, part.x, part.y, part.width, part.height, () => {
          const n = () => Math.floor(rand() * 7) - 3; // -3〜+3
          return rgba(base.r + n(), base.g + n(), base.b + n(), 128 + Math.floor(rand() * 128));
        });
      });

      const { layers } = generateLayersFromImageData(image);

      const seen = new Set<string>();
      for (const layer of layers) {
        const partKeys = new Set<string>();
        for (const key of opaqueKeys(layer)) {
          expect(seen.has(key), `${key} が複数のレイヤーに含まれている`).toBe(false);
          seen.add(key);
          const [x, y] = key.split(',').map(Number);
          const i = (y * SKIN_WIDTH + x) * 4;
          expect(layer.pixels[y][x]).toEqual(
            rgba(image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3])
          );
          partKeys.add(bodyPartKey(regionAt(x, y)!));
        }
        expect(partKeys.size).toBe(1);
      }

      let opaqueCount = 0;
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 0) opaqueCount++;
      expect(seen.size).toBe(opaqueCount);
    });
  });

  describe('3D での面のつながり（UV 上で離れた辺）', () => {
    it('head-right の左端と head-back の右端（同じ高さ）は同じレイヤーになる', () => {
      const image = imageWith([
        [0, 10, RED],
        [31, 10, RED],
      ]);
      const { layers } = generateLayersFromImageData(image);
      expect(layers).toHaveLength(1);
    });

    it('3D でつながっていない位置（高さが異なる）同士は別レイヤーのまま', () => {
      const image = imageWith([
        [0, 10, RED],
        [31, 12, RED],
      ]);
      expect(generateLayersFromImageData(image).layers).toHaveLength(2);
    });

    it('3D で接していても色がしきい値を超えて異なれば別レイヤーになる', () => {
      const image = imageWith([
        [0, 10, RED],
        [31, 10, BLUE],
      ]);
      expect(generateLayersFromImageData(image).layers).toHaveLength(2);
    });

    it('head-back の上端と head-top の上端は左右反転してつながる', () => {
      // back の x=24+i は top の x=15-i とつながる
      const connected = imageWith([
        [26, 8, RED],
        [13, 0, RED],
      ]);
      const notConnected = imageWith([
        [26, 8, RED],
        [10, 0, RED],
      ]);
      expect(generateLayersFromImageData(connected).layers).toHaveLength(1);
      expect(generateLayersFromImageData(notConnected).layers).toHaveLength(2);
    });

    it('head-left の上端と head-top の右端は反転してつながる', () => {
      // left の (16+i, 8) は top の (15, 7-i) とつながる
      const connected = imageWith([
        [20, 8, RED],
        [15, 3, RED],
      ]);
      expect(generateLayersFromImageData(connected).layers).toHaveLength(1);
    });

    it('腕（right-arm-right の左端と right-arm-back の右端）も 3D でつながる', () => {
      const image = imageWith([
        [40, 25, RED],
        [55, 25, RED],
      ]);
      const { layers } = generateLayersFromImageData(image);
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe('right-arm-1');
    });

    it('オーバーレイ（hat-right の左端と hat-back の右端）も 3D でつながる', () => {
      const image = imageWith([
        [32, 10, RED],
        [63, 10, RED],
      ]);
      const { layers } = generateLayersFromImageData(image);
      expect(layers).toHaveLength(1);
      expect(layers[0].name).toBe('head-overlay-1');
    });
  });

  describe('ノイズ設定', () => {
    const single = () => imageWith([[10, 10, RED]]);

    it('既定（normal）のしきい値からノイズ設定を算出する', () => {
      const { layers } = generateLayersFromImageData(single());
      expect(layers[0].noiseSettings).toEqual({ brightness: 15, hue: 8 });
    });

    it('しきい値が大きいほどノイズも大きくなる', () => {
      const noiseFor = (t: number) => generateLayersFromImageData(single(), t).layers[0].noiseSettings;
      const strict = noiseFor(COLOR_THRESHOLD_PRESETS.strict);
      const normal = noiseFor(COLOR_THRESHOLD_PRESETS.normal);
      const loose = noiseFor(COLOR_THRESHOLD_PRESETS.loose);
      const veryLoose = noiseFor(COLOR_THRESHOLD_PRESETS.veryLoose);

      expect(veryLoose).toEqual({ brightness: 40, hue: 20 });
      for (const [a, b] of [
        [strict, normal],
        [normal, loose],
        [loose, veryLoose],
      ]) {
        expect(a.brightness).toBeLessThan(b.brightness);
        expect(a.hue).toBeLessThan(b.hue);
      }
    });

    it('ノイズは brightness 50・hue 25 を上限とする', () => {
      const { layers } = generateLayersFromImageData(single(), 400);
      expect(layers[0].noiseSettings).toEqual({ brightness: 50, hue: 25 });
    });

    it('applyNoiseFromThreshold=false ならノイズは 0', () => {
      const { layers } = generateLayersFromImageData(single(), COLOR_THRESHOLD_PRESETS.veryLoose, false);
      expect(layers[0].noiseSettings).toEqual({ brightness: 0, hue: 0 });
    });

    it('各レイヤーのノイズ設定は独立したオブジェクト', () => {
      const image = imageWith([
        [10, 10, RED],
        [12, 12, RED],
      ]);
      const { layers } = generateLayersFromImageData(image);
      expect(layers[0].noiseSettings).not.toBe(layers[1].noiseSettings);
    });
  });

  describe('画像サイズ', () => {
    it('64x64 より大きい画像は左上 64x64 だけを、正しい行幅で読み取る', () => {
      const image = createImage(128, 128);
      setImagePixel(image, 10, 10, RED);
      setImagePixel(image, 70, 10, BLUE); // 範囲外（右）
      setImagePixel(image, 10, 70, GREEN); // 範囲外（下）

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(1);
      expect(opaqueKeys(layers[0])).toEqual(keysOf([[10, 10]]));
      expect(layers[0].pixels[10][10]).toEqual(RED);
      expect(layers[0].pixels).toHaveLength(SKIN_HEIGHT);
    });

    it('64x32 の旧形式スキンでも読み取れ、下半分は透明として扱う', () => {
      const image = createImage(64, 32);
      setImagePixel(image, 10, 10, RED);
      setImagePixel(image, 22, 25, BLUE);

      const { layers } = generateLayersFromImageData(image);

      expect(layers).toHaveLength(2);
      expect(layerAt(layers, 10, 10).pixels[10][10]).toEqual(RED);
      expect(layerAt(layers, 22, 25).pixels[25][22]).toEqual(BLUE);
      for (const layer of layers) {
        for (let y = 32; y < SKIN_HEIGHT; y++) {
          expect(layer.pixels[y].every((p) => p === null)).toBe(true);
        }
      }
    });
  });
});

// ---- mergeSimilarLayers ----

describe('mergeSimilarLayers', () => {
  it('レイヤーが 0 枚なら空配列を返す', () => {
    expect(mergeSimilarLayers([]).layers).toEqual([]);
  });

  it('レイヤーが 1 枚ならピクセルを複製したコピーを返す', () => {
    const layer = makeLayer({ id: 'a', pixels: pixelsWith([[1, 1, RED]]) });

    const { layers } = mergeSimilarLayers([layer]);

    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('a');
    expect(layers[0].pixels).toEqual(layer.pixels);
    expect(layers[0].pixels).not.toBe(layer.pixels);
    layers[0].pixels[1][1]!.r = 0;
    expect(layer.pixels[1][1]).toEqual(RED);
  });

  it('基本色が類似したレイヤーを最初のレイヤーに統合し、ピクセルを合わせる', () => {
    const a = makeLayer({ id: 'a', baseColor: rgba(100, 100, 100), pixels: pixelsWith([[1, 1, rgba(100, 100, 100)]]) });
    const b = makeLayer({ id: 'b', baseColor: rgba(110, 100, 100), pixels: pixelsWith([[2, 2, rgba(110, 100, 100)]]) });
    const c = makeLayer({ id: 'c', baseColor: BLUE, pixels: pixelsWith([[3, 3, BLUE]]) });

    const { layers } = mergeSimilarLayers([a, b, c]);

    expect(layers.map((l) => l.id)).toEqual(['a', 'c']);
    const merged = layers[0];
    expect(merged.name).toBe('a');
    expect(merged.baseColor).toEqual(rgba(100, 100, 100));
    expect(opaqueKeys(merged)).toEqual(keysOf([[1, 1], [2, 2]]));
    expect(merged.pixels[2][2]).toEqual(rgba(110, 100, 100));
    expect(opaqueKeys(layers[1])).toEqual(keysOf([[3, 3]]));
  });

  it('類似していないレイヤーはすべて残る', () => {
    const layers = [
      makeLayer({ id: 'r', baseColor: RED, pixels: pixelsWith([[1, 1, RED]]) }),
      makeLayer({ id: 'g', baseColor: GREEN, pixels: pixelsWith([[2, 2, GREEN]]) }),
      makeLayer({ id: 'b', baseColor: BLUE, pixels: pixelsWith([[3, 3, BLUE]]) }),
    ];

    const result = mergeSimilarLayers(layers, COLOR_THRESHOLD_PRESETS.normal, false);

    expect(result.layers.map((l) => l.id)).toEqual(['r', 'g', 'b']);
    result.layers.forEach((l, i) => expect(l.pixels).toEqual(layers[i].pixels));
  });

  it('しきい値を大きくするとより離れた色も統合される', () => {
    const make = () => [
      makeLayer({ id: 'a', baseColor: rgba(0, 0, 0), pixels: pixelsWith([[1, 1, rgba(0, 0, 0)]]) }),
      makeLayer({ id: 'b', baseColor: rgba(40, 0, 0), pixels: pixelsWith([[2, 2, rgba(40, 0, 0)]]) }),
    ];

    expect(mergeSimilarLayers(make()).layers).toHaveLength(2);
    expect(mergeSimilarLayers(make(), COLOR_THRESHOLD_PRESETS.loose).layers).toHaveLength(1);
  });

  it('同じ座標にピクセルがある場合は先に現れた（前面の）レイヤーのピクセルを残す', () => {
    const a = makeLayer({ id: 'a', order: 0, baseColor: RED, pixels: pixelsWith([[5, 5, RED]]) });
    const b = makeLayer({
      id: 'b',
      order: 1,
      baseColor: RED,
      pixels: pixelsWith([
        [5, 5, rgba(210, 30, 30)],
        [6, 5, rgba(210, 30, 30)],
      ]),
    });

    const { layers } = mergeSimilarLayers([a, b]);

    expect(layers).toHaveLength(1);
    expect(layers[0].pixels[5][5]).toEqual(RED);
    expect(layers[0].pixels[5][6]).toEqual(rgba(210, 30, 30));
  });

  it('統合先のアルファ 0 のピクセルは統合元のピクセルで埋められる', () => {
    const a = makeLayer({ id: 'a', baseColor: RED, pixels: pixelsWith([[5, 5, rgba(0, 0, 0, 0)]]) });
    const b = makeLayer({ id: 'b', baseColor: RED, pixels: pixelsWith([[5, 5, RED]]) });

    const { layers } = mergeSimilarLayers([a, b]);

    expect(layers[0].pixels[5][5]).toEqual(RED);
  });

  it('ノイズ設定は既存値としきい値由来の値の大きい方になる', () => {
    const a = makeLayer({ id: 'a', baseColor: RED, noiseSettings: { brightness: 5, hue: 20 } });
    const b = makeLayer({ id: 'b', baseColor: BLUE, noiseSettings: { brightness: 0, hue: 0 } });

    const { layers } = mergeSimilarLayers([a, b], COLOR_THRESHOLD_PRESETS.normal);

    // normal(30) → brightness 15, hue 8
    expect(layers[0].noiseSettings).toEqual({ brightness: 15, hue: 20 });
    expect(layers[1].noiseSettings).toEqual({ brightness: 15, hue: 8 });
  });

  it('applyNoiseFromThreshold=false ならノイズ設定は変更しない', () => {
    const a = makeLayer({ id: 'a', baseColor: RED, noiseSettings: { brightness: 5, hue: 20 } });
    const b = makeLayer({ id: 'b', baseColor: BLUE, noiseSettings: { brightness: 0, hue: 0 } });

    const { layers } = mergeSimilarLayers([a, b], COLOR_THRESHOLD_PRESETS.normal, false);

    expect(layers[0].noiseSettings).toEqual({ brightness: 5, hue: 20 });
    expect(layers[1].noiseSettings).toEqual({ brightness: 0, hue: 0 });
  });

  it('入力のレイヤーは変更せず、結果のピクセルは入力と共有されない', () => {
    const a = makeLayer({ id: 'a', baseColor: RED, pixels: pixelsWith([[1, 1, RED]]) });
    const b = makeLayer({ id: 'b', baseColor: RED, pixels: pixelsWith([[2, 2, RED]]) });
    const input = [a, b];
    const snapshot = structuredClone(input);

    const { layers } = mergeSimilarLayers(input);

    expect(input).toEqual(snapshot);
    layers[0].pixels[1][1]!.g = 99;
    layers[0].pixels[2][2]!.g = 99;
    expect(input).toEqual(snapshot);
  });
});

// ---- mergeLayers ----

describe('mergeLayers', () => {
  function setup() {
    const target = makeLayer({
      id: 'target',
      name: '統合先',
      order: 0,
      baseColor: RED,
      pixels: pixelsWith([
        [1, 1, RED],
        [2, 1, RED],
      ]),
    });
    const other = makeLayer({ id: 'other', order: 1, pixels: pixelsWith([[9, 9, GREEN]]) });
    const source = makeLayer({
      id: 'source',
      order: 2,
      baseColor: BLUE,
      pixels: pixelsWith([
        [2, 1, BLUE], // 重なる
        [3, 1, BLUE], // 統合先にない
        [4, 1, rgba(0, 0, 255, 0)], // 透明
      ]),
    });
    return { target, other, source, layers: [target, other, source] };
  }

  it('統合元のレイヤーを削除し、そのピクセルを統合先に取り込む', () => {
    const { layers } = setup();

    const result = mergeLayers(layers, 'source', 'target');

    expect(result.layers.map((l) => l.id)).toEqual(['target', 'other']);
    const merged = result.layers[0];
    expect(merged.pixels[1][1]).toEqual(RED);
    expect(merged.pixels[1][3]).toEqual(BLUE);
  });

  it('重なるピクセルは統合元（上に描かれる側）が優先される', () => {
    const { layers } = setup();
    const merged = mergeLayers(layers, 'source', 'target').layers[0];
    expect(merged.pixels[1][2]).toEqual(BLUE);
  });

  it('統合元のアルファ 0 のピクセルは取り込まない', () => {
    const { layers } = setup();
    const merged = mergeLayers(layers, 'source', 'target').layers[0];
    expect(merged.pixels[1][4]).toBeNull();
  });

  it('統合先のその他のプロパティ（名前・基本色・order）は維持される', () => {
    const { layers } = setup();
    const merged = mergeLayers(layers, 'source', 'target').layers[0];
    expect(merged).toMatchObject({ id: 'target', name: '統合先', baseColor: RED, order: 0 });
  });

  it('関係のないレイヤーはそのまま残る', () => {
    const { layers, other } = setup();
    const result = mergeLayers(layers, 'source', 'target');
    expect(result.layers[1]).toEqual(other);
    expect(result.layers[1].pixels).not.toBe(other.pixels);
  });

  it('統合元と統合先が同じ ID なら何も変えない', () => {
    const { layers } = setup();
    const result = mergeLayers(layers, 'target', 'target');
    expect(result.layers).toEqual(layers);
  });

  it('存在しない ID を指定すると何も変えない', () => {
    const { layers } = setup();
    expect(mergeLayers(layers, 'missing', 'target').layers).toEqual(layers);
    expect(mergeLayers(layers, 'source', 'missing').layers).toEqual(layers);
  });

  it('入力のレイヤーは変更せず、結果のピクセルは入力と共有されない', () => {
    const { layers } = setup();
    const snapshot = structuredClone(layers);

    const result = mergeLayers(layers, 'source', 'target');

    expect(layers).toEqual(snapshot);
    result.layers[0].pixels[1][3]!.r = 1;
    result.layers[1].pixels[9][9]!.r = 1;
    expect(layers).toEqual(snapshot);
  });
});

// ---- splitLayerByColor ----

describe('splitLayerByColor', () => {
  it('存在しないレイヤー ID を指定すると何も変えない', () => {
    const layers = [makeLayer({ id: 'a', pixels: pixelsWith([[1, 1, RED]]) })];
    expect(splitLayerByColor(layers, 'missing').layers).toEqual(layers);
  });

  it('ピクセルのないレイヤーは分割しない', () => {
    const layers = [makeLayer({ id: 'a', pixels: pixelsWith([[1, 1, rgba(1, 2, 3, 0)]]) })];
    expect(splitLayerByColor(layers, 'a').layers).toEqual(layers);
  });

  it('色がひとまとまりのレイヤーは分割せずそのまま返す', () => {
    const layers = [
      makeLayer({
        id: 'a',
        pixels: pixelsWith([
          [10, 10, rgba(100, 100, 100)],
          [11, 10, rgba(105, 100, 100)],
          [12, 11, rgba(110, 100, 100)],
        ]),
      }),
    ];

    const result = splitLayerByColor(layers, 'a');

    expect(result.layers).toEqual(layers);
    expect(result.layers[0].pixels).not.toBe(layers[0].pixels);
  });

  it('異なる色の領域ごとに新しいレイヤーへ分割し、元のレイヤーは取り除く', () => {
    const entries: Array<[number, number, RGBA]> = [];
    for (let x = 8; x < 12; x++) entries.push([x, 10, RED]);
    for (let x = 12; x < 16; x++) entries.push([x, 10, BLUE]);
    const original = makeLayer({
      id: 'orig',
      name: '服',
      layerType: 'direct',
      opacity: 60,
      pixels: pixelsWith(entries),
    });

    const { layers } = splitLayerByColor([original], 'orig');

    expect(layers).toHaveLength(2);
    expect(layers.some((l) => l.id === 'orig')).toBe(false);
    expect(new Set(layers.map((l) => l.name))).toEqual(new Set(['服-1', '服-2']));
    expect(layers.map((l) => l.order)).toEqual([0, 1]);

    const red = layerAt(layers, 8, 10);
    const blue = layerAt(layers, 15, 10);
    expect(red).not.toBe(blue);
    expect(opaqueKeys(red)).toEqual(keysOf([[8, 10], [9, 10], [10, 10], [11, 10]]));
    expect(opaqueKeys(blue)).toEqual(keysOf([[12, 10], [13, 10], [14, 10], [15, 10]]));
    expect(red.baseColor).toEqual(RED);
    expect(blue.baseColor).toEqual(BLUE);
    for (const l of layers) {
      expect(l.layerType).toBe('direct');
      expect(l.opacity).toBe(60);
    }
  });

  it('分割後の各レイヤーは元の色（アルファ含む）を正確に保持し、全ピクセルを漏れなく分配する', () => {
    const rand = lcg(7);
    const entries: Array<[number, number, RGBA]> = [];
    for (let y = 8; y < 16; y++) {
      for (let x = 8; x < 16; x++) {
        const base = x < 12 ? RED : GREEN;
        entries.push([x, y, rgba(base.r + Math.floor(rand() * 5), base.g, base.b, 100 + Math.floor(rand() * 155))]);
      }
    }
    const original = makeLayer({ id: 'orig', pixels: pixelsWith(entries) });

    const { layers } = splitLayerByColor([original], 'orig', COLOR_THRESHOLD_PRESETS.strict);

    expect(layers).toHaveLength(2);
    const seen = new Set<string>();
    for (const layer of layers) {
      for (const key of opaqueKeys(layer)) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        const [x, y] = key.split(',').map(Number);
        expect(layer.pixels[y][x]).toEqual(original.pixels[y][x]);
      }
    }
    expect(seen).toEqual(opaqueKeys(original));
  });

  it('同じ色でも離れた領域は別レイヤーに分割する', () => {
    const original = makeLayer({
      id: 'orig',
      pixels: pixelsWith([
        [10, 10, RED],
        [13, 13, RED],
      ]),
    });

    const { layers } = splitLayerByColor([original], 'orig');

    expect(layers).toHaveLength(2);
    expect(layerAt(layers, 10, 10)).not.toBe(layerAt(layers, 13, 13));
  });

  it('3D でつながる辺（head-right の左端と head-back の右端）の同色ピクセルは分割しない', () => {
    const layers = [
      makeLayer({
        id: 'orig',
        pixels: pixelsWith([
          [0, 10, RED],
          [31, 10, RED],
        ]),
      }),
    ];

    const result = splitLayerByColor(layers, 'orig');

    expect(result.layers).toEqual(layers);
  });

  it('しきい値によって分割するかどうかが変わる', () => {
    const layers = [
      makeLayer({
        id: 'orig',
        pixels: pixelsWith([
          [10, 10, rgba(100, 100, 100)],
          [11, 10, rgba(110, 110, 110)],
        ]),
      }),
    ];

    expect(splitLayerByColor(layers, 'orig', COLOR_THRESHOLD_PRESETS.normal).layers).toHaveLength(1);
    expect(splitLayerByColor(layers, 'orig', COLOR_THRESHOLD_PRESETS.strict).layers).toHaveLength(2);
  });

  it('ノイズ設定はしきい値から算出し、applyNoiseFromThreshold=false なら 0 にする', () => {
    const make = () => [
      makeLayer({
        id: 'orig',
        noiseSettings: { brightness: 33, hue: 33 },
        pixels: pixelsWith([
          [10, 10, RED],
          [11, 10, BLUE],
        ]),
      }),
    ];

    const withNoise = splitLayerByColor(make(), 'orig', COLOR_THRESHOLD_PRESETS.normal).layers;
    for (const l of withNoise) expect(l.noiseSettings).toEqual({ brightness: 15, hue: 8 });

    const withoutNoise = splitLayerByColor(make(), 'orig', COLOR_THRESHOLD_PRESETS.normal, false).layers;
    for (const l of withoutNoise) expect(l.noiseSettings).toEqual({ brightness: 0, hue: 0 });
  });

  it('透明（a=0）のピクセルは分割結果に含めない', () => {
    const original = makeLayer({
      id: 'orig',
      pixels: pixelsWith([
        [10, 10, RED],
        [13, 13, BLUE],
        [20, 20, rgba(0, 0, 0, 0)],
      ]),
    });

    const { layers } = splitLayerByColor([original], 'orig');

    expect(layers).toHaveLength(2);
    for (const l of layers) expect(l.pixels[20][20]).toBeNull();
  });

  it('対象外のレイヤーはそのまま残る', () => {
    const other = makeLayer({ id: 'other', order: 0, pixels: pixelsWith([[1, 1, GREEN]]) });
    const target = makeLayer({
      id: 'target',
      order: 1,
      pixels: pixelsWith([
        [10, 10, RED],
        [11, 10, BLUE],
      ]),
    });

    const { layers } = splitLayerByColor([other, target], 'target');

    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(other);
    expect(layers[0].pixels).not.toBe(other.pixels);
  });

  it('入力のレイヤーは変更しない', () => {
    const input = [
      makeLayer({
        id: 'orig',
        pixels: pixelsWith([
          [10, 10, RED],
          [11, 10, BLUE],
        ]),
      }),
    ];
    const snapshot = structuredClone(input);

    const { layers } = splitLayerByColor(input, 'orig');
    layers[0].pixels[10][10]!.r = 1;
    layers[1].pixels[10][11]!.r = 1;

    expect(input).toEqual(snapshot);
  });
});

// ---- splitLayerBySelection ----

describe('splitLayerBySelection', () => {
  function setup() {
    const source = makeLayer({
      id: 'src',
      name: '髪',
      order: 3,
      groupId: 'group-1',
      layerType: 'singleColor',
      opacity: 70,
      noiseSettings: { brightness: 12, hue: 4 },
      pixels: pixelsWith([
        [1, 1, rgba(100, 0, 0)],
        [2, 1, rgba(200, 50, 0, 128)],
        [3, 1, rgba(0, 0, 255)],
      ]),
    });
    const other = makeLayer({ id: 'other', order: 5, pixels: pixelsWith([[9, 9, GREEN]]) });
    return { source, other, layers: [source, other] };
  }

  it('選択したピクセルを新しいレイヤーへ移し、新レイヤーの ID を返す', () => {
    const { layers } = setup();

    const result = splitLayerBySelection(layers, 'src', [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);

    expect(result.newLayerId).not.toBeNull();
    expect(result.layers).toHaveLength(3);
    const newLayer = result.layers[result.layers.length - 1];
    expect(newLayer.id).toBe(result.newLayerId);
    expect(newLayer.id).not.toBe('src');

    // 新レイヤーには選択ピクセルが元の色のまま入る
    expect(opaqueKeys(newLayer)).toEqual(keysOf([[1, 1], [2, 1]]));
    expect(newLayer.pixels[1][1]).toEqual(rgba(100, 0, 0));
    expect(newLayer.pixels[1][2]).toEqual(rgba(200, 50, 0, 128));

    // 元レイヤーからは取り除かれる
    const src = result.layers.find((l) => l.id === 'src')!;
    expect(opaqueKeys(src)).toEqual(keysOf([[3, 1]]));
    expect(src.pixels[1][1]).toBeNull();
    expect(src.pixels[1][2]).toBeNull();
  });

  it('新レイヤーは元レイヤーの設定を引き継ぎ、最大 order + 1 の位置に追加される', () => {
    const { layers } = setup();

    const result = splitLayerBySelection(layers, 'src', [{ x: 1, y: 1 }]);
    const newLayer = result.layers.find((l) => l.id === result.newLayerId)!;

    expect(newLayer).toMatchObject({
      name: '髪-split',
      groupId: 'group-1',
      layerType: 'singleColor',
      opacity: 70,
      visible: true,
      noiseSettings: { brightness: 12, hue: 4 },
      order: 6,
    });
    expect(new Set(result.layers.map((l) => l.order)).size).toBe(result.layers.length);
  });

  it('新レイヤーの基本色は選択ピクセルの平均色（アルファ 255）', () => {
    const { layers } = setup();

    const result = splitLayerBySelection(layers, 'src', [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    const newLayer = result.layers.find((l) => l.id === result.newLayerId)!;

    expect(newLayer.baseColor).toEqual(rgba(150, 25, 0, 255));
  });

  it('範囲外・空のピクセルを含む選択は、有効なピクセルだけを移す', () => {
    const { layers } = setup();

    const result = splitLayerBySelection(layers, 'src', [
      { x: -1, y: 1 },
      { x: 64, y: 1 },
      { x: 1, y: 64 },
      { x: 5, y: 5 }, // 空
      { x: 3, y: 1 }, // 有効
    ]);
    const newLayer = result.layers.find((l) => l.id === result.newLayerId)!;

    expect(opaqueKeys(newLayer)).toEqual(keysOf([[3, 1]]));
    expect(newLayer.baseColor).toEqual(rgba(0, 0, 255));
  });

  it('選択が空、または有効なピクセルがなければ何もしない（newLayerId は null）', () => {
    const { layers } = setup();

    const empty = splitLayerBySelection(layers, 'src', []);
    expect(empty.newLayerId).toBeNull();
    expect(empty.layers).toEqual(layers);

    const invalid = splitLayerBySelection(layers, 'src', [
      { x: 5, y: 5 },
      { x: -3, y: 0 },
    ]);
    expect(invalid.newLayerId).toBeNull();
    expect(invalid.layers).toEqual(layers);
  });

  it('アルファ 0 のピクセルは選択しても移さない', () => {
    const layer = makeLayer({ id: 'src', pixels: pixelsWith([[1, 1, rgba(10, 10, 10, 0)]]) });
    const result = splitLayerBySelection([layer], 'src', [{ x: 1, y: 1 }]);
    expect(result.newLayerId).toBeNull();
  });

  it('存在しないレイヤー ID を指定すると何もしない', () => {
    const { layers } = setup();
    const result = splitLayerBySelection(layers, 'missing', [{ x: 1, y: 1 }]);
    expect(result.newLayerId).toBeNull();
    expect(result.layers).toEqual(layers);
  });

  it('対象外のレイヤーはそのまま残る', () => {
    const { layers, other } = setup();
    const result = splitLayerBySelection(layers, 'src', [{ x: 1, y: 1 }]);
    const kept = result.layers.find((l) => l.id === 'other')!;
    expect(kept).toEqual(other);
    expect(kept.pixels).not.toBe(other.pixels);
  });

  it('入力のレイヤーは変更しない', () => {
    const { layers } = setup();
    const snapshot = structuredClone(layers);

    const result = splitLayerBySelection(layers, 'src', [{ x: 1, y: 1 }]);
    const newLayer = result.layers.find((l) => l.id === result.newLayerId)!;
    newLayer.pixels[1][1]!.r = 0;

    expect(layers).toEqual(snapshot);
  });
});

// ---- blendBorderPixels ----

describe('blendBorderPixels', () => {
  // head-front (8..15, 8..15) の内側で隣り合う 2 レイヤー
  function twoLayers() {
    const a = makeLayer({ id: 'a', order: 0, pixels: pixelsWith([[10, 10, rgba(100, 100, 100)]]) });
    const b = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[11, 10, rgba(200, 0, 50)]]) });
    return [a, b];
  }

  it('異なるレイヤーと接するピクセルを、隣接色へ指定割合だけ近づける', () => {
    const { layers } = blendBorderPixels(twoLayers(), 15);

    // a: 100 + (200-100)*0.15 = 115, 100 + (0-100)*0.15 = 85, 100 + (50-100)*0.15 = 92.5 → 93
    expect(layers[0].pixels[10][10]).toEqual(rgba(115, 85, 93));
    // b: 200 + (100-200)*0.15 = 185, 0 + 15 = 15, 50 + 7.5 = 57.5 → 58
    expect(layers[1].pixels[10][11]).toEqual(rgba(185, 15, 58));
  });

  it('強さを省略すると 15% でブレンドする', () => {
    expect(blendBorderPixels(twoLayers()).layers).toEqual(blendBorderPixels(twoLayers(), 15).layers);
  });

  it('強さ 0 なら色は変わらず、100 なら隣接色の平均そのものになる', () => {
    const input = twoLayers();

    const zero = blendBorderPixels(input, 0).layers;
    expect(zero).toEqual(input);

    const full = blendBorderPixels(input, 100).layers;
    expect(full[0].pixels[10][10]).toEqual(rgba(200, 0, 50));
    expect(full[1].pixels[10][11]).toEqual(rgba(100, 100, 100));
  });

  it('複数の異なるレイヤーと接する場合は、それらの平均色へ近づける（ブレンド前の色を使う）', () => {
    const center = makeLayer({ id: 'c', order: 0, pixels: pixelsWith([[10, 10, rgba(0, 0, 0)]]) });
    const left = makeLayer({ id: 'l', order: 1, pixels: pixelsWith([[9, 10, rgba(200, 0, 0)]]) });
    const up = makeLayer({ id: 'u', order: 2, pixels: pixelsWith([[10, 9, rgba(0, 100, 0)]]) });

    const { layers } = blendBorderPixels([center, left, up], 50);

    // 平均 (100, 50, 0) へ 50% → (50, 25, 0)
    expect(layers[0].pixels[10][10]).toEqual(rgba(50, 25, 0));
    // left は center の元の色 (0,0,0) とだけ接する（up とは斜めなので対象外）
    expect(layers[1].pixels[10][9]).toEqual(rgba(100, 0, 0));
    expect(layers[2].pixels[9][10]).toEqual(rgba(0, 50, 0));
  });

  it('同じレイヤーのピクセルとしか接していないピクセルは変化しない', () => {
    const a = makeLayer({
      id: 'a',
      order: 0,
      pixels: pixelsWith([
        [9, 10, rgba(100, 100, 100)],
        [10, 10, rgba(100, 100, 100)],
      ]),
    });
    const b = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[11, 10, rgba(200, 200, 200)]]) });

    const { layers } = blendBorderPixels([a, b], 50);

    expect(layers[0].pixels[10][9]).toEqual(rgba(100, 100, 100));
    expect(layers[0].pixels[10][10]).toEqual(rgba(150, 150, 150));
  });

  it('斜めに接するだけのピクセルはブレンドしない', () => {
    const a = makeLayer({ id: 'a', order: 0, pixels: pixelsWith([[10, 10, RED]]) });
    const b = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[11, 11, BLUE]]) });

    const input = [a, b];
    expect(blendBorderPixels(input, 50).layers).toEqual(input);
  });

  it('アルファ値はブレンドしても変わらない', () => {
    const a = makeLayer({ id: 'a', order: 0, pixels: pixelsWith([[10, 10, rgba(0, 0, 0, 77)]]) });
    const b = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[11, 10, rgba(100, 100, 100, 255)]]) });

    const { layers } = blendBorderPixels([a, b], 50);

    expect(layers[0].pixels[10][10]).toEqual(rgba(50, 50, 50, 77));
    expect(layers[1].pixels[10][11]!.a).toBe(255);
  });

  it('異なる部位の境界（右脚と胴体）ではブレンドしない', () => {
    const leg = makeLayer({ id: 'leg', order: 0, pixels: pixelsWith([[15, 25, RED]]) });
    const body = makeLayer({ id: 'body', order: 1, pixels: pixelsWith([[16, 25, BLUE]]) });

    const input = [leg, body];
    expect(blendBorderPixels(input, 50).layers).toEqual(input);
  });

  it('スキンレイヤーが異なる境界（head-back と hat-right）ではブレンドしない', () => {
    const head = makeLayer({ id: 'head', order: 0, pixels: pixelsWith([[31, 10, RED]]) });
    const hat = makeLayer({ id: 'hat', order: 1, pixels: pixelsWith([[32, 10, BLUE]]) });

    const input = [head, hat];
    expect(blendBorderPixels(input, 50).layers).toEqual(input);
  });

  it('同じ部位の異なる面の境界（head-right と head-front）ではブレンドする', () => {
    const right = makeLayer({ id: 'r', order: 0, pixels: pixelsWith([[7, 10, rgba(0, 0, 0)]]) });
    const front = makeLayer({ id: 'f', order: 1, pixels: pixelsWith([[8, 10, rgba(100, 100, 100)]]) });

    const { layers } = blendBorderPixels([right, front], 50);

    expect(layers[0].pixels[10][7]).toEqual(rgba(50, 50, 50));
    expect(layers[1].pixels[10][8]).toEqual(rgba(50, 50, 50));
  });

  it('どの部位にも属さない領域のピクセルはブレンドしない', () => {
    const a = makeLayer({ id: 'a', order: 0, pixels: pixelsWith([[0, 0, RED]]) });
    const b = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[1, 0, BLUE]]) });

    const input = [a, b];
    expect(blendBorderPixels(input, 50).layers).toEqual(input);
  });

  it('隣接位置に複数レイヤーのピクセルがある場合は、前面（order が小さい）レイヤーの色を使う', () => {
    const target = makeLayer({ id: 't', order: 2, pixels: pixelsWith([[10, 10, rgba(0, 0, 0)]]) });
    const back = makeLayer({ id: 'back', order: 1, pixels: pixelsWith([[11, 10, rgba(0, 0, 200)]]) });
    const front = makeLayer({ id: 'front', order: 0, pixels: pixelsWith([[11, 10, rgba(200, 0, 0)]]) });

    // 配列の並びと order が一致しない場合でも order で判定する
    const { layers } = blendBorderPixels([target, back, front], 50, 't');

    expect(layers[0].pixels[10][10]).toEqual(rgba(100, 0, 0));
  });

  it('targetLayerId を指定すると、そのレイヤーだけをブレンドする', () => {
    const input = twoLayers();

    const { layers } = blendBorderPixels(input, 15, 'a');

    expect(layers[0].pixels[10][10]).toEqual(rgba(115, 85, 93));
    expect(layers[1]).toEqual(input[1]);
    expect(layers[1].pixels).not.toBe(input[1].pixels);
  });

  it('入力のレイヤーは変更しない', () => {
    const input = twoLayers();
    const snapshot = structuredClone(input);

    const { layers } = blendBorderPixels(input, 50);
    layers[0].pixels[10][10]!.r = 0;

    expect(input).toEqual(snapshot);
  });

  it('レイヤーが 1 枚だけなら何も変わらない', () => {
    const layer = makeLayer({
      id: 'a',
      pixels: pixelsWith([
        [10, 10, RED],
        [11, 10, BLUE],
      ]),
    });
    expect(blendBorderPixels([layer], 100).layers).toEqual([layer]);
  });
});
