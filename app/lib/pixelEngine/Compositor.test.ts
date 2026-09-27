import { afterEach, describe, expect, it, vi } from 'vitest';
import { Compositor } from './Compositor';
import { BUFFER_SIZE, PixelBuffer, SKIN_HEIGHT, SKIN_WIDTH } from './PixelBuffer';
import { computeLayerComposite } from '../layerComposite';
import type { Layer, LayerGroup, LayerPixels, RGBA } from '../../types/editor';

// ---- テスト用ヘルパー ----

type Pixel = [number, number, number, number];

const TRANSPARENT: Pixel = [0, 0, 0, 0];
const RED: Pixel = [255, 0, 0, 255];
const GREEN: Pixel = [0, 255, 0, 255];
const BLUE: Pixel = [0, 0, 255, 255];

// 全面を同じ色で塗ったバッファ（デフォルトは 1x1）
function solid([r, g, b, a]: Pixel, width = 1, height = 1): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  buf.setPixelRect(0, 0, width - 1, height - 1, r, g, b, a);
  return buf;
}

// 指定座標だけ色を置いた 64x64 バッファ
function bufferWith(entries: Array<[x: number, y: number, color: Pixel]>): PixelBuffer {
  const buf = new PixelBuffer();
  for (const [x, y, [r, g, b, a]] of entries) buf.setPixel(x, y, r, g, b, a);
  return buf;
}

// 合成結果から 1 ピクセルを取り出す
function pixelAt(result: Uint8ClampedArray, x: number, y: number, width = SKIN_WIDTH): Pixel {
  const i = (y * width + x) * 4;
  return [result[i], result[i + 1], result[i + 2], result[i + 3]];
}

function layer(buffer: PixelBuffer, order: number, overrides: { visible?: boolean; opacity?: number } = {}) {
  return { buffer, order, visible: true, opacity: 100, ...overrides };
}

// 1x1 の合成を行い、そのピクセルを返す
function composite1x1(layers: ReturnType<typeof layer>[]): Pixel {
  return pixelAt(new Compositor(1, 1).composite(layers), 0, 0, 1);
}

// 決定的な擬似乱数（線形合同法）
function createRandom(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * n);
  };
}

// ---- メインスレッド版（computeLayerComposite）との比較用ヘルパー ----

function emptyLayerPixels(): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () =>
    Array.from({ length: SKIN_WIDTH }, () => null as RGBA | null)
  );
}

// ランダムなピクセルデータ（一部は null / 完全透明）
function randomLayerPixels(rand: (n: number) => number, alpha: () => number): LayerPixels {
  const pixels = emptyLayerPixels();
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      // 約 1/4 は未描画のまま
      if (rand(4) === 0) continue;
      pixels[y][x] = { r: rand(256), g: rand(256), b: rand(256), a: alpha() };
    }
  }
  return pixels;
}

function toPixelBuffer(pixels: LayerPixels): PixelBuffer {
  const buf = new PixelBuffer();
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const p = pixels[y][x];
      if (p) buf.setPixel(x, y, p.r, p.g, p.b, p.a);
    }
  }
  return buf;
}

function makeLayer(overrides: Partial<Layer> & { id: string; pixels: LayerPixels }): Layer {
  return {
    name: overrides.id,
    baseColor: { r: 0, g: 0, b: 0, a: 255 },
    noiseSettings: { brightness: 0, hue: 0 },
    groupId: null,
    order: 0,
    layerType: 'direct',
    visible: true,
    opacity: 100,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<LayerGroup> & { id: string }): LayerGroup {
  return { name: overrides.id, collapsed: false, order: 0, visible: true, ...overrides };
}

// ストアのレイヤー/グループを Worker の compositeFromMap 引数に変換して合成する
// （非表示レイヤー・非表示グループのレイヤーは visibleLayerIds から除外する）
function compositeViaWorker(layers: Layer[], groups: LayerGroup[]): number[] {
  const hiddenGroupIds = new Set(groups.filter((g) => !g.visible).map((g) => g.id));
  const layerMap = new Map<string, PixelBuffer>();
  const visibleLayerIds: string[] = [];
  const layerOpacities: Record<string, number> = {};
  const layerOrders: Record<string, number> = {};
  const layerGroupIds: Record<string, string | null> = {};
  const groupOrders: Record<string, number> = {};

  for (const l of layers) {
    layerMap.set(l.id, toPixelBuffer(l.pixels));
    if (l.visible && !(l.groupId && hiddenGroupIds.has(l.groupId))) visibleLayerIds.push(l.id);
    layerOpacities[l.id] = l.opacity;
    layerOrders[l.id] = l.order;
    layerGroupIds[l.id] = l.groupId;
  }
  for (const g of groups) groupOrders[g.id] = g.order;

  const result = new Compositor().compositeFromMap(
    layerMap,
    visibleLayerIds,
    layerOpacities,
    layerOrders,
    layerGroupIds,
    groupOrders
  );
  return Array.from(result);
}

function compositeViaMainThread(layers: Layer[], groups: LayerGroup[]): number[] {
  const out: number[] = [];
  for (const row of computeLayerComposite(layers, groups)) {
    for (const p of row) out.push(p.r, p.g, p.b, p.a);
  }
  return out;
}

// 2 つの合成結果のチャンネルごとの最大差
function maxChannelDiff(a: number[], b: number[]): number {
  expect(a).toHaveLength(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

// グループ・順序・表示状態が入り混じったシナリオ
function mixedScenario(
  rand: (n: number) => number,
  alpha: () => number,
  opacityFor: (index: number) => number = () => 100
): { layers: Layer[]; groups: LayerGroup[] } {
  const groups = [
    makeGroup({ id: 'g-front', order: 0 }),
    makeGroup({ id: 'g-back', order: 1 }),
    makeGroup({ id: 'g-hidden', order: 2, visible: false }),
  ];
  const specs: Array<Partial<Layer>> = [
    { groupId: 'g-back', order: 0 },
    { groupId: 'g-front', order: 1 },
    { groupId: null, order: 5 },
    { groupId: 'g-front', order: 0 },
    { groupId: 'g-back', order: 1 },
    { groupId: null, order: -1 },
    { groupId: 'g-hidden', order: 0 },
    { groupId: 'g-front', order: 2, visible: false },
    { groupId: 'missing-group', order: 3 },
  ];
  const layers = specs.map((spec, i) =>
    makeLayer({
      id: `layer-${i}`,
      pixels: randomLayerPixels(rand, alpha),
      opacity: opacityFor(i),
      ...spec,
    })
  );
  return { layers, groups };
}

// ---- 基本動作 ----

describe('Compositor 基本', () => {
  it('デフォルトでは 64x64 x RGBA の結果を返す', () => {
    const result = new Compositor().composite([]);
    expect(result).toBeInstanceOf(Uint8ClampedArray);
    expect(result.length).toBe(BUFFER_SIZE);
  });

  it('任意サイズを指定すると width * height * 4 の結果を返す', () => {
    const compositor = new Compositor(3, 2);
    expect(compositor.composite([]).length).toBe(24);
    expect(compositor.compositeFromMap(new Map(), [], {}, {}).length).toBe(24);
  });

  it('レイヤーが無い場合は完全透明', () => {
    const result = new Compositor().composite([]);
    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('描画されていないピクセルは (0, 0, 0, 0) のまま', () => {
    const result = new Compositor().composite([layer(bufferWith([[5, 5, RED]]), 0)]);
    expect(pixelAt(result, 5, 5)).toEqual(RED);
    expect(pixelAt(result, 4, 5)).toEqual(TRANSPARENT);
    expect(pixelAt(result, 6, 5)).toEqual(TRANSPARENT);
    expect(pixelAt(result, 5, 6)).toEqual(TRANSPARENT);
  });

  it('単一の不透明レイヤーはそのまま出力される', () => {
    const buf = bufferWith([
      [0, 0, RED],
      [63, 0, GREEN],
      [0, 63, BLUE],
      [10, 20, [12, 34, 56, 255]],
    ]);
    const result = new Compositor().composite([layer(buf, 0)]);
    expect(Array.from(result)).toEqual(Array.from(buf.data));
  });

  it('入力レイヤーのバッファは変更しない', () => {
    const back = solid(BLUE, 2, 2);
    const front = solid([255, 0, 0, 128], 2, 2);
    const backBefore = Array.from(back.data);
    const frontBefore = Array.from(front.data);

    new Compositor(2, 2).composite([layer(back, 1), layer(front, 0, { opacity: 50 })]);

    expect(Array.from(back.data)).toEqual(backBefore);
    expect(Array.from(front.data)).toEqual(frontBefore);
  });

  it('呼び出しごとに結果がクリアされ、前回の合成結果が残らない', () => {
    const compositor = new Compositor(1, 1);
    expect(Array.from(compositor.composite([layer(solid(RED), 0)]))).toEqual(RED);

    expect(Array.from(compositor.composite([]))).toEqual(TRANSPARENT);

    // 半透明レイヤーを繰り返し合成しても累積しない
    const half = solid([0, 0, 255, 128]);
    const first = Array.from(compositor.composite([layer(half, 0)]));
    const second = Array.from(compositor.composite([layer(half, 0)]));
    expect(second).toEqual(first);
    expect(first).toEqual([0, 0, 255, 128]);
  });
});

// ---- アルファブレンド（Porter-Duff over） ----

describe('Compositor アルファブレンド', () => {
  it.each([
    ['透明な背景', TRANSPARENT],
    ['不透明な背景', BLUE],
    ['半透明な背景', [10, 200, 30, 90] as Pixel],
  ])('不透明な前景は %s を完全に置き換える', (_label, background) => {
    expect(
      composite1x1([layer(solid(background), 1), layer(solid([12, 34, 56, 255]), 0)])
    ).toEqual([12, 34, 56, 255]);
  });

  it.each([
    ['不透明な背景', [200, 100, 50, 255] as Pixel],
    ['半透明な背景', [200, 100, 50, 128] as Pixel],
  ])('完全透明な前景（RGB が入っていても）は %s をそのまま残す', (_label, background) => {
    expect(composite1x1([layer(solid(background), 1), layer(solid([255, 255, 255, 0]), 0)])).toEqual(
      background
    );
  });

  it('透明な背景上の半透明ピクセルは色とアルファをそのまま保つ', () => {
    expect(composite1x1([layer(solid([40, 80, 120, 128]), 0)])).toEqual([40, 80, 120, 128]);
    expect(composite1x1([layer(solid([40, 80, 120, 1]), 0)])).toEqual([40, 80, 120, 1]);
  });

  it('不透明な背景に半透明を重ねると色が線形に混ざり、アルファは 255', () => {
    // 前景アルファ 128/255: r = 255 * 128/255 = 128, b = 255 * 127/255 = 127
    expect(composite1x1([layer(solid(BLUE), 1), layer(solid([255, 0, 0, 128]), 0)])).toEqual([
      128, 0, 127, 255,
    ]);
  });

  it('半透明同士の合成は over 演算の式に従う', () => {
    // αout = 128/255 + 128/255 * (1 - 128/255) = 48896/65025 → 191.75 → 192
    // r = 255 * (128*255) / 48896 ≈ 170.2 → 170, b = 255 * (128*127) / 48896 ≈ 84.8 → 85
    expect(
      composite1x1([layer(solid([0, 0, 255, 128]), 1), layer(solid([255, 0, 0, 128]), 0)])
    ).toEqual([170, 0, 85, 192]);
  });

  it('アルファが加わるほど結果のアルファは単調に増える（255 を超えない）', () => {
    const half = solid([100, 100, 100, 128]);
    const alphas: number[] = [];
    for (let n = 1; n <= 6; n++) {
      const layers = Array.from({ length: n }, (_, i) => layer(half, i));
      alphas.push(composite1x1(layers)[3]);
    }
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
    }
    expect(alphas[alphas.length - 1]).toBeLessThanOrEqual(255);
    // 同じ色を重ねても色は変わらない
    expect(composite1x1(Array.from({ length: 6 }, (_, i) => layer(half, i))).slice(0, 3)).toEqual([
      100, 100, 100,
    ]);
  });
});

// ---- 表示・不透明度 ----

describe('Compositor 表示状態と不透明度', () => {
  it('非表示レイヤーは合成されない', () => {
    expect(
      composite1x1([layer(solid(BLUE), 1), layer(solid(RED), 0, { visible: false })])
    ).toEqual(BLUE);
    expect(composite1x1([layer(solid(RED), 0, { visible: false })])).toEqual(TRANSPARENT);
  });

  it.each([0, -10])('不透明度 %i のレイヤーは合成されない', (opacity) => {
    expect(composite1x1([layer(solid(BLUE), 1), layer(solid(RED), 0, { opacity })])).toEqual(BLUE);
  });

  it('不透明度 100 ではピクセルのアルファがそのまま使われる', () => {
    expect(composite1x1([layer(solid([10, 20, 30, 77]), 0, { opacity: 100 })])).toEqual([
      10, 20, 30, 77,
    ]);
  });

  it.each([
    [50, 255, 128], // 127.5 → 128
    [50, 128, 64],
    [20, 255, 51],
    [1, 255, 3], // 2.55 → 3
  ])('不透明度 %i%% はピクセルのアルファ %i に乗算される（→ %i）', (opacity, alpha, expected) => {
    expect(composite1x1([layer(solid([10, 20, 30, alpha]), 0, { opacity })])).toEqual([
      10, 20, 30, expected,
    ]);
  });

  it('不透明度 60% の不透明レイヤーは背景と 6:4 で混ざる', () => {
    // 実効アルファ 0.6: r = 255 * 0.6 = 153, b = 255 * 0.4 = 102
    expect(composite1x1([layer(solid(BLUE), 1), layer(solid(RED), 0, { opacity: 60 })])).toEqual([
      153, 0, 102, 255,
    ]);
  });

  it('背面レイヤーの不透明度も結果のアルファに反映される', () => {
    expect(composite1x1([layer(solid(BLUE), 1, { opacity: 40 })])).toEqual([0, 0, 255, 102]);
  });
});

// ---- 重なり順 ----

describe('Compositor.composite の重なり順', () => {
  it('order が小さいレイヤーほど前面に描かれる', () => {
    expect(composite1x1([layer(solid(RED), 0), layer(solid(BLUE), 1)])).toEqual(RED);
    expect(composite1x1([layer(solid(RED), 1), layer(solid(BLUE), 0)])).toEqual(BLUE);
  });

  it('配列の並び順ではなく order で決まる', () => {
    const a = layer(solid([255, 0, 0, 128]), 2);
    const b = layer(solid([0, 255, 0, 128]), 0);
    const c = layer(solid(BLUE), 1);
    const expected = composite1x1([a, b, c]);
    expect(composite1x1([c, b, a])).toEqual(expected);
    expect(composite1x1([b, a, c])).toEqual(expected);
    // 最前面（order 0）の緑が最後に重なり、不透明な青（order 1）が赤（order 2）を隠す
    expect(expected).toEqual([0, 128, 127, 255]);
  });

  it('負の order も扱える', () => {
    expect(composite1x1([layer(solid(RED), 0), layer(solid(GREEN), -5)])).toEqual(GREEN);
  });

  it('半透明の重なりは順序によって結果が変わる', () => {
    const red = solid([255, 0, 0, 128]);
    const blue = solid([0, 0, 255, 128]);
    const redFront = composite1x1([layer(red, 0), layer(blue, 1)]);
    const blueFront = composite1x1([layer(red, 1), layer(blue, 0)]);
    expect(redFront).toEqual([170, 0, 85, 192]);
    expect(blueFront).toEqual([85, 0, 170, 192]);
  });

  it('非表示レイヤーは順序に関係なく無視され、残りの順序は保たれる', () => {
    expect(
      composite1x1([
        layer(solid(GREEN), 0, { visible: false }),
        layer(solid(RED), 1),
        layer(solid(BLUE), 2),
      ])
    ).toEqual(RED);
  });
});

// ---- compositeFromMap ----

describe('Compositor.compositeFromMap', () => {
  function run(
    buffers: Record<string, PixelBuffer>,
    visibleLayerIds: string[],
    layerOpacities: Record<string, number>,
    layerOrders: Record<string, number>,
    layerGroupIds?: Record<string, string | null>,
    groupOrders?: Record<string, number>
  ): Pixel {
    const result = new Compositor(1, 1).compositeFromMap(
      new Map(Object.entries(buffers)),
      visibleLayerIds,
      layerOpacities,
      layerOrders,
      layerGroupIds,
      groupOrders
    );
    return pixelAt(result, 0, 0, 1);
  }

  it('visibleLayerIds に含まれるレイヤーだけを合成する', () => {
    const buffers = { red: solid(RED), blue: solid(BLUE) };
    const orders = { red: 0, blue: 1 };
    expect(run(buffers, ['blue'], {}, orders)).toEqual(BLUE);
    expect(run(buffers, ['red', 'blue'], {}, orders)).toEqual(RED);
    expect(run(buffers, [], {}, orders)).toEqual(TRANSPARENT);
  });

  it('存在しないレイヤーIDは無視する', () => {
    expect(() => run({ red: solid(RED) }, ['ghost', 'red'], {}, {})).not.toThrow();
    expect(run({ red: solid(RED) }, ['ghost', 'red'], {}, {})).toEqual(RED);
  });

  it('不透明度が指定されていないレイヤーは 100% として扱う', () => {
    expect(run({ a: solid([10, 20, 30, 200]) }, ['a'], {}, {})).toEqual([10, 20, 30, 200]);
  });

  it('不透明度を適用する', () => {
    expect(run({ a: solid(RED) }, ['a'], { a: 50 }, {})).toEqual([255, 0, 0, 128]);
  });

  it.each([0, -1])('不透明度 %i のレイヤーは合成しない', (opacity) => {
    expect(run({ back: solid(BLUE), a: solid(RED) }, ['back', 'a'], { a: opacity }, { back: 1 })).toEqual(
      BLUE
    );
  });

  it('order が指定されていないレイヤーは order 0 として扱う', () => {
    // 未指定(0) は order 1 より前面
    expect(run({ a: solid(RED), b: solid(BLUE) }, ['a', 'b'], {}, { b: 1 })).toEqual(RED);
    // 未指定(0) は order -1 より背面
    expect(run({ a: solid(RED), b: solid(BLUE) }, ['b', 'a'], {}, { b: -1 })).toEqual(BLUE);
  });

  it('グループ情報を省略した場合はレイヤーの order だけで並べる', () => {
    const buffers = { a: solid(RED), b: solid(GREEN), c: solid(BLUE) };
    expect(run(buffers, ['a', 'b', 'c'], {}, { a: 2, b: 0, c: 1 })).toEqual(GREEN);
    expect(run(buffers, ['a', 'b', 'c'], {}, { a: -3, b: 0, c: 1 })).toEqual(RED);
  });

  it('グループの order がレイヤーの order より優先される', () => {
    // front グループ(0) の a は layer order が大きくても、back グループ(1) の b より前面
    expect(
      run(
        { a: solid(RED), b: solid(BLUE) },
        ['a', 'b'],
        {},
        { a: 10, b: 0 },
        { a: 'front', b: 'back' },
        { front: 0, back: 1 }
      )
    ).toEqual(RED);
  });

  it('同じグループ内ではレイヤーの order で並べる', () => {
    const buffers = { a: solid(RED), b: solid(BLUE) };
    const groupIds = { a: 'g', b: 'g' };
    expect(run(buffers, ['a', 'b'], {}, { a: 0, b: 1 }, groupIds, { g: 3 })).toEqual(RED);
    expect(run(buffers, ['a', 'b'], {}, { a: 1, b: 0 }, groupIds, { g: 3 })).toEqual(BLUE);
  });

  it('グループ order 0 も有効な値として扱う（未設定扱いにしない）', () => {
    expect(
      run(
        { a: solid(RED), b: solid(BLUE) },
        ['a', 'b'],
        {},
        { a: 5, b: 0 },
        { a: 'g0', b: 'g1' },
        { g0: 0, g1: 1 }
      )
    ).toEqual(RED);
  });

  it('グループに属さないレイヤーは全グループより背面に描かれる', () => {
    expect(
      run(
        { ungrouped: solid(RED), grouped: solid(BLUE) },
        ['ungrouped', 'grouped'],
        {},
        { ungrouped: -100, grouped: 100 },
        { ungrouped: null, grouped: 'g' },
        { g: 1000 }
      )
    ).toEqual(BLUE);
  });

  it('groupOrders に無いグループのレイヤーは未所属と同じく背面扱い', () => {
    expect(
      run(
        { orphan: solid(RED), grouped: solid(BLUE) },
        ['orphan', 'grouped'],
        {},
        { orphan: 0, grouped: 5 },
        { orphan: 'deleted-group', grouped: 'g' },
        { g: 9 }
      )
    ).toEqual(BLUE);

    // 未所属レイヤー同士と同じくレイヤー order で比較される
    expect(
      run(
        { orphan: solid(RED), ungrouped: solid(BLUE) },
        ['orphan', 'ungrouped'],
        {},
        { orphan: 0, ungrouped: 1 },
        { orphan: 'deleted-group', ungrouped: null },
        {}
      )
    ).toEqual(RED);
  });

  it('64x64 の各ピクセルを独立に合成する', () => {
    const back = bufferWith([
      [0, 0, BLUE],
      [1, 0, BLUE],
    ]);
    const front = bufferWith([
      [1, 0, RED],
      [2, 0, [0, 255, 0, 128]],
    ]);
    const result = new Compositor().compositeFromMap(
      new Map([
        ['back', back],
        ['front', front],
      ]),
      ['back', 'front'],
      {},
      { back: 1, front: 0 }
    );
    expect(pixelAt(result, 0, 0)).toEqual(BLUE);
    expect(pixelAt(result, 1, 0)).toEqual(RED);
    expect(pixelAt(result, 2, 0)).toEqual([0, 255, 0, 128]);
    expect(pixelAt(result, 3, 0)).toEqual(TRANSPARENT);
  });

  it('呼び出しごとに結果がクリアされる（composite との間でも）', () => {
    const compositor = new Compositor(1, 1);
    compositor.composite([layer(solid(RED), 0)]);
    const result = compositor.compositeFromMap(new Map([['a', solid(RED)]]), [], {}, {});
    expect(Array.from(result)).toEqual(TRANSPARENT);

    compositor.compositeFromMap(new Map([['a', solid(RED)]]), ['a'], {}, {});
    expect(Array.from(compositor.composite([]))).toEqual(TRANSPARENT);
  });
});

// ---- メインスレッド版との一致 ----

describe('メインスレッドの computeLayerComposite との一致', () => {
  it('不透明/透明のみのピクセルでは、グループ・順序・表示状態を含めて完全に一致する', () => {
    const rand = createRandom(1);
    const { layers, groups } = mixedScenario(rand, () => (rand(2) === 0 ? 0 : 255));

    expect(compositeViaWorker(layers, groups)).toEqual(compositeViaMainThread(layers, groups));
  });

  it('半透明ピクセル（不透明度 100%）でも一致する（.5 ちょうどの丸め境界による ±1 の誤差のみ許容）', () => {
    const rand = createRandom(2);
    const { layers, groups } = mixedScenario(rand, () => rand(256));

    const worker = compositeViaWorker(layers, groups);
    const main = compositeViaMainThread(layers, groups);
    expect(maxChannelDiff(worker, main)).toBeLessThanOrEqual(1);
  });

  it('不透明度を掛けた実効アルファが整数になる場合は一致する（.5 ちょうどの丸め境界による ±1 の誤差のみ許容）', () => {
    const rand = createRandom(3);
    // 不透明度 20/40/60/80% × 5 の倍数のアルファ、50% × 偶数のアルファ → 実効アルファは整数
    // （メインスレッド版は実効アルファを整数に丸めてからブレンドするため、
    //   小数になるケースは比較対象外）
    const opacities = [20, 40, 60, 80, 100, 20, 40, 60, 80];
    const fifths = mixedScenario(rand, () => rand(52) * 5, (i) => opacities[i]);
    const rand2 = createRandom(4);
    const half = mixedScenario(rand2, () => rand2(128) * 2, () => 50);

    expect(
      maxChannelDiff(
        compositeViaWorker(fifths.layers, fifths.groups),
        compositeViaMainThread(fifths.layers, fifths.groups)
      )
    ).toBeLessThanOrEqual(1);
    expect(
      maxChannelDiff(
        compositeViaWorker(half.layers, half.groups),
        compositeViaMainThread(half.layers, half.groups)
      )
    ).toBeLessThanOrEqual(1);
  });

  it('全レイヤー非表示・非表示グループのみの場合はどちらも完全透明', () => {
    const rand = createRandom(5);
    const groups = [makeGroup({ id: 'g', visible: false })];
    const layers = [
      makeLayer({ id: 'a', pixels: randomLayerPixels(rand, () => 255), visible: false }),
      makeLayer({ id: 'b', pixels: randomLayerPixels(rand, () => 255), groupId: 'g' }),
    ];
    const worker = compositeViaWorker(layers, groups);
    expect(worker.every((v) => v === 0)).toBe(true);
    expect(worker).toEqual(compositeViaMainThread(layers, groups));
  });
});

// ---- 結果の取り出し ----

describe('getResultBuffer', () => {
  it('直近の合成結果と同じ内容の ArrayBuffer を返す', () => {
    const compositor = new Compositor(2, 1);
    const result = compositor.composite([layer(solid(RED, 2, 1), 0)]);

    const ab = compositor.getResultBuffer();

    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(ab.byteLength).toBe(2 * 1 * 4);
    expect(Array.from(new Uint8ClampedArray(ab))).toEqual(Array.from(result));
  });

  it('デフォルトサイズでは BUFFER_SIZE バイト', () => {
    const compositor = new Compositor();
    compositor.composite([]);
    expect(compositor.getResultBuffer().byteLength).toBe(BUFFER_SIZE);
  });

  it('コピーを返すため、その後の合成や書き換え・転送の影響を受けない', () => {
    const compositor = new Compositor(1, 1);
    compositor.composite([layer(solid(RED), 0)]);
    const ab = compositor.getResultBuffer();

    compositor.composite([layer(solid(BLUE), 0)]);
    expect(Array.from(new Uint8ClampedArray(ab))).toEqual(RED);

    // 取り出したバッファを転送しても合成は続けられる
    structuredClone(ab, { transfer: [ab] });
    expect(Array.from(compositor.composite([layer(solid(GREEN), 0)]))).toEqual(GREEN);
  });
});

describe('toImageData', () => {
  // Node / jsdom には ImageData が無いため、最小限の代替を用意する
  class FakeImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      if (data.length !== width * height * 4) throw new Error('IndexSizeError');
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('合成結果と同じサイズ・内容の ImageData を返す', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const compositor = new Compositor(3, 2);
    const result = compositor.composite([layer(solid([1, 2, 3, 255], 3, 2), 0)]);

    const img = compositor.toImageData();

    expect(img).toBeInstanceOf(FakeImageData);
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(Array.from(img.data)).toEqual(Array.from(result));
  });

  it('ImageData のデータはコピーで、その後の合成に影響されない', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const compositor = new Compositor(1, 1);
    compositor.composite([layer(solid(RED), 0)]);

    const img = compositor.toImageData();
    compositor.composite([layer(solid(BLUE), 0)]);

    expect(Array.from(img.data)).toEqual(RED);
  });
});
