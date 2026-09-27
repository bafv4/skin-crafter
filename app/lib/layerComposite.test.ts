import { describe, it, expect } from 'vitest';
import {
  alphaBlend,
  alphaBlendMut,
  computeLayerComposite,
  createEmptyComposite,
  groupRanks,
  rgbaEqual,
  sortFrontToBack,
} from './layerComposite';
import {
  type Layer,
  type LayerGroup,
  type LayerPixels,
  type RGBA,
  SKIN_HEIGHT,
  SKIN_WIDTH,
} from '../types/editor';

// ---- テスト用ヘルパー ----

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

const rgba = (r: number, g: number, b: number, a: number): RGBA => ({ r, g, b, a });

// 64x64 の全面 null（透明）ピクセル
function emptyPixels(): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () =>
    Array.from({ length: SKIN_WIDTH }, () => null as RGBA | null)
  );
}

// 指定座標だけ色を置いたピクセルデータ
function pixelsWith(entries: Array<[x: number, y: number, color: RGBA]>): LayerPixels {
  const pixels = emptyPixels();
  for (const [x, y, color] of entries) {
    pixels[y][x] = { ...color };
  }
  return pixels;
}

// 全面を同じ色で塗ったピクセルデータ
function filledPixels(color: RGBA): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () =>
    Array.from({ length: SKIN_WIDTH }, () => ({ ...color }) as RGBA | null)
  );
}

function makeLayer(overrides: Partial<Layer> & { id: string }): Layer {
  return {
    name: overrides.id,
    baseColor: { r: 0, g: 0, b: 0, a: 255 },
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

function makeGroup(overrides: Partial<LayerGroup> & { id: string }): LayerGroup {
  return {
    name: overrides.id,
    collapsed: false,
    order: 0,
    visible: true,
    ...overrides,
  };
}

// 合成結果が全ピクセル透明であることを確認する
function expectAllTransparent(composite: RGBA[][]): void {
  expect(composite).toHaveLength(SKIN_HEIGHT);
  for (const row of composite) {
    expect(row).toHaveLength(SKIN_WIDTH);
    for (const px of row) {
      expect(px).toEqual(TRANSPARENT);
    }
  }
}

// ---- createEmptyComposite ----

describe('createEmptyComposite', () => {
  it('64x64 の完全透明なピクセル配列を返す', () => {
    const composite = createEmptyComposite();
    expectAllTransparent(composite);
  });

  it('各ピクセルは独立したオブジェクトで、1つを書き換えても他に影響しない', () => {
    const composite = createEmptyComposite();
    composite[0][0].r = 255;
    composite[0][0].a = 255;

    expect(composite[0][1]).toEqual(TRANSPARENT);
    expect(composite[1][0]).toEqual(TRANSPARENT);
    expect(composite[63][63]).toEqual(TRANSPARENT);
    // 行も別の配列である
    expect(composite[0]).not.toBe(composite[1]);
  });

  it('呼び出しごとに新しい配列を返す（前回の結果の変更が残らない）', () => {
    const first = createEmptyComposite();
    first[10][20].g = 123;
    first[10][20].a = 200;

    const second = createEmptyComposite();
    expect(second).not.toBe(first);
    expect(second[10][20]).toEqual(TRANSPARENT);
  });
});

// ---- alphaBlend ----

describe('alphaBlend', () => {
  describe('不透明な前景', () => {
    it.each([
      ['透明な背景', TRANSPARENT],
      ['不透明な背景', BLUE],
      ['半透明な背景', rgba(10, 200, 30, 90)],
    ])('%s を前景色で完全に置き換える', (_label, background) => {
      expect(alphaBlend(background, rgba(12, 34, 56, 255))).toEqual(rgba(12, 34, 56, 255));
    });
  });

  describe('完全透明な前景', () => {
    it.each([
      ['不透明な背景', rgba(200, 100, 50, 255)],
      ['半透明な背景', rgba(200, 100, 50, 128)],
      ['ほぼ透明な背景', rgba(17, 33, 250, 1)],
    ])('%s をそのまま残す', (_label, background) => {
      // 前景の色成分は無視される
      expect(alphaBlend(background, rgba(255, 255, 255, 0))).toEqual(background);
    });

    it('透明同士の合成は (0,0,0,0) に正規化される', () => {
      expect(alphaBlend(rgba(10, 20, 30, 0), rgba(40, 50, 60, 0))).toEqual(TRANSPARENT);
    });
  });

  describe('半透明の混色（Porter-Duff over）', () => {
    it('透明な背景に重ねると前景色そのものになる', () => {
      expect(alphaBlend(TRANSPARENT, rgba(10, 20, 30, 128))).toEqual(rgba(10, 20, 30, 128));
    });

    it('背景のアルファが 0 なら背景の色成分は結果に寄与しない', () => {
      expect(alphaBlend(rgba(255, 255, 255, 0), rgba(10, 20, 30, 128))).toEqual(
        rgba(10, 20, 30, 128)
      );
    });

    it('アルファ 128 の赤を不透明な青に重ねるとほぼ半々に混ざる', () => {
      // fgA = 128/255 → r = 255*128/255 = 128, b = 255*127/255 = 127
      expect(alphaBlend(BLUE, rgba(255, 0, 0, 128))).toEqual(rgba(128, 0, 127, 255));
    });

    it('アルファ 51（20%）の前景は 20:80 で線形補間される', () => {
      // 200*0.2 + 100*0.8 = 120, 100*0.2 + 150*0.8 = 140, 50*0.2 + 200*0.8 = 170
      expect(alphaBlend(rgba(100, 150, 200, 255), rgba(200, 100, 50, 51))).toEqual(
        rgba(120, 140, 170, 255)
      );
    });

    it('半透明同士の合成では出力アルファと色が正しく正規化される', () => {
      // αout = 128/255 + 128/255 * 127/255 ≈ 0.752 → 192
      // r = 255 * (128/255) / αout ≈ 170, b = 255 * (128/255 * 127/255) / αout ≈ 85
      expect(alphaBlend(rgba(0, 0, 255, 128), rgba(255, 0, 0, 128))).toEqual(
        rgba(170, 0, 85, 192)
      );
    });

    it('同じ色を半透明で重ねると色は変わらずアルファだけ増える', () => {
      expect(alphaBlend(rgba(255, 0, 0, 128), rgba(255, 0, 0, 128))).toEqual(
        rgba(255, 0, 0, 192)
      );
    });
  });

  it('入力を変更せず、新しいオブジェクトを返す', () => {
    const background = rgba(0, 0, 255, 255);
    const foreground = rgba(255, 0, 0, 128);
    const result = alphaBlend(background, foreground);

    expect(result).not.toBe(background);
    expect(result).not.toBe(foreground);
    expect(background).toEqual(rgba(0, 0, 255, 255));
    expect(foreground).toEqual(rgba(255, 0, 0, 128));
  });

  it('不変条件: 出力は 0〜255 の整数で、アルファは入力アルファの最大値以上になる', () => {
    const alphas = [0, 1, 64, 127, 128, 200, 254, 255];
    const colors = [rgba(0, 0, 0, 0), rgba(255, 255, 255, 0), rgba(37, 180, 99, 0)];

    for (const bgA of alphas) {
      for (const fgA of alphas) {
        for (const bgColor of colors) {
          for (const fgColor of colors) {
            const bg = { ...bgColor, a: bgA };
            const fg = { ...fgColor, a: fgA };
            const out = alphaBlend(bg, fg);

            for (const channel of [out.r, out.g, out.b, out.a]) {
              expect(Number.isInteger(channel)).toBe(true);
              expect(channel).toBeGreaterThanOrEqual(0);
              expect(channel).toBeLessThanOrEqual(255);
            }
            expect(out.a).toBeGreaterThanOrEqual(Math.max(bgA, fgA));
          }
        }
      }
    }
  });

  it('不変条件: 前景と背景が同じ RGB なら、アルファに関わらず RGB は保たれる', () => {
    const color = { r: 37, g: 180, b: 99 };
    for (const bgA of [1, 50, 128, 255]) {
      for (const fgA of [1, 50, 128, 255]) {
        const out = alphaBlend({ ...color, a: bgA }, { ...color, a: fgA });
        expect({ r: out.r, g: out.g, b: out.b }).toEqual(color);
      }
    }
  });
});

// ---- alphaBlendMut ----

describe('alphaBlendMut', () => {
  it('ターゲットをその場で書き換え、前景は変更しない', () => {
    const target = rgba(0, 0, 255, 255);
    const foreground = rgba(255, 0, 0, 128);

    const returned = alphaBlendMut(target, foreground);

    expect(returned).toBeUndefined();
    expect(target).toEqual(rgba(128, 0, 127, 255));
    expect(foreground).toEqual(rgba(255, 0, 0, 128));
  });

  it.each([
    [TRANSPARENT, rgba(10, 20, 30, 128)],
    [BLUE, rgba(255, 0, 0, 128)],
    [rgba(0, 0, 255, 128), rgba(255, 0, 0, 128)],
    [rgba(100, 150, 200, 255), rgba(200, 100, 50, 51)],
    [rgba(1, 2, 3, 77), rgba(4, 5, 6, 0)],
    [rgba(1, 2, 3, 0), rgba(4, 5, 6, 0)],
    [rgba(1, 2, 3, 77), rgba(4, 5, 6, 255)],
  ])('alphaBlend と同じ結果になる（背景 %o / 前景 %o）', (background, foreground) => {
    const target = { ...background };
    alphaBlendMut(target, foreground);
    expect(target).toEqual(alphaBlend(background, foreground));
  });

  it('透明なターゲットに完全透明な前景を重ねると色成分もクリアされる', () => {
    const target = rgba(99, 88, 77, 0);
    alphaBlendMut(target, rgba(1, 2, 3, 0));
    expect(target).toEqual(TRANSPARENT);
  });

  it('連続して適用すると背面から前面への重ね合わせになる', () => {
    const target = { ...TRANSPARENT };
    alphaBlendMut(target, BLUE); // 最背面: 不透明な青
    expect(target).toEqual(BLUE);

    alphaBlendMut(target, rgba(0, 255, 0, 128)); // 半透明の緑
    expect(target).toEqual(rgba(0, 128, 127, 255));

    alphaBlendMut(target, rgba(255, 0, 0, 64)); // 薄い赤
    // fgA = 64/255 → r = 255*64/255 = 64, g = 128*191/255 ≈ 96, b = 127*191/255 ≈ 95
    expect(target).toEqual(rgba(64, 96, 95, 255));
  });
});

// ---- computeLayerComposite ----

describe('computeLayerComposite', () => {
  describe('基本動作', () => {
    it('レイヤーが無い場合は 64x64 の透明な画像を返す', () => {
      expectAllTransparent(computeLayerComposite([], []));
    });

    it('単一の不透明レイヤーのピクセルがそのまま出力され、null は透明になる', () => {
      const layer = makeLayer({
        id: 'l1',
        pixels: pixelsWith([
          [0, 0, RED],
          [63, 63, GREEN],
          [5, 10, rgba(12, 34, 56, 255)],
        ]),
      });

      const composite = computeLayerComposite([layer], []);

      expect(composite).toHaveLength(SKIN_HEIGHT);
      expect(composite[0]).toHaveLength(SKIN_WIDTH);
      expect(composite[0][0]).toEqual(RED);
      expect(composite[63][63]).toEqual(GREEN);
      // pixels は [y][x] で参照される
      expect(composite[10][5]).toEqual(rgba(12, 34, 56, 255));
      expect(composite[5][10]).toEqual(TRANSPARENT);
      expect(composite[0][1]).toEqual(TRANSPARENT);
    });

    it('全面を塗ったレイヤーは全ピクセルに反映される', () => {
      const composite = computeLayerComposite(
        [makeLayer({ id: 'fill', pixels: filledPixels(rgba(1, 2, 3, 255)) })],
        []
      );
      for (const row of composite) {
        for (const px of row) {
          expect(px).toEqual(rgba(1, 2, 3, 255));
        }
      }
    });

    it('半透明ピクセルは透明な背景に対してそのまま出力される', () => {
      const layer = makeLayer({ id: 'l1', pixels: pixelsWith([[3, 4, rgba(10, 20, 30, 77)]]) });
      expect(computeLayerComposite([layer], [])[4][3]).toEqual(rgba(10, 20, 30, 77));
    });

    it('アルファ 0 のピクセルは色成分を持っていても結果に影響しない', () => {
      const back = makeLayer({ id: 'back', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });
      const front = makeLayer({
        id: 'front',
        order: 0,
        pixels: pixelsWith([
          [0, 0, rgba(255, 0, 0, 0)],
          [1, 0, rgba(255, 0, 0, 0)],
        ]),
      });

      const composite = computeLayerComposite([back, front], []);
      expect(composite[0][0]).toEqual(BLUE);
      expect(composite[0][1]).toEqual(TRANSPARENT);
    });

    it('行が欠けている・空のピクセル配列でも例外を投げず透明として扱う', () => {
      const sparse = makeLayer({ id: 'sparse', pixels: [] });
      const partial = makeLayer({ id: 'partial', order: 1, pixels: [[RED]] });

      const composite = computeLayerComposite([sparse, partial], []);
      expect(composite[0][0]).toEqual(RED);
      expect(composite[0][1]).toEqual(TRANSPARENT);
      expect(composite[1][0]).toEqual(TRANSPARENT);
      expect(composite[63][63]).toEqual(TRANSPARENT);
    });
  });

  describe('入力の不変性', () => {
    it('レイヤーのピクセルも layers 配列の並びも変更しない', () => {
      const back = makeLayer({ id: 'back', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });
      const front = makeLayer({
        id: 'front',
        order: 0,
        opacity: 50,
        pixels: pixelsWith([[0, 0, rgba(255, 0, 0, 200)]]),
      });
      const layers = [front, back];

      computeLayerComposite(layers, []);

      expect(layers).toEqual([front, back]);
      expect(layers[0]).toBe(front);
      expect(layers[1]).toBe(back);
      expect(front.pixels[0][0]).toEqual(rgba(255, 0, 0, 200));
      expect(back.pixels[0][0]).toEqual(BLUE);
    });

    it('結果のピクセルはレイヤーのピクセルと別オブジェクトで、結果を変更してもレイヤーに影響しない', () => {
      const layer = makeLayer({ id: 'l1', pixels: pixelsWith([[0, 0, RED]]) });
      const composite = computeLayerComposite([layer], []);

      expect(composite[0][0]).not.toBe(layer.pixels[0][0]);
      composite[0][0].g = 99;
      expect(layer.pixels[0][0]).toEqual(RED);

      // 再計算しても前回の結果の変更は残らない
      expect(computeLayerComposite([layer], [])[0][0]).toEqual(RED);
    });
  });

  describe('レイヤーの重ね順', () => {
    it('order が小さいレイヤーほど前面に描画される（配列の並びには依存しない）', () => {
      const front = makeLayer({ id: 'front', order: 0, pixels: pixelsWith([[0, 0, RED]]) });
      const back = makeLayer({ id: 'back', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });

      expect(computeLayerComposite([front, back], [])[0][0]).toEqual(RED);
      expect(computeLayerComposite([back, front], [])[0][0]).toEqual(RED);
    });

    it('前面が半透明なら背面の色と混ざる', () => {
      const front = makeLayer({
        id: 'front',
        order: 0,
        pixels: pixelsWith([[0, 0, rgba(255, 0, 0, 128)]]),
      });
      const back = makeLayer({ id: 'back', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });

      expect(computeLayerComposite([front, back], [])[0][0]).toEqual(rgba(128, 0, 127, 255));

      // order を入れ替えると不透明な青が前面になり、赤は見えなくなる
      const swappedFront = { ...front, order: 1 };
      const swappedBack = { ...back, order: 0 };
      expect(computeLayerComposite([swappedFront, swappedBack], [])[0][0]).toEqual(BLUE);
    });

    it('3 枚のレイヤーを背面から順に重ねる', () => {
      const layers = [
        makeLayer({ id: 'top', order: 0, pixels: pixelsWith([[0, 0, rgba(255, 0, 0, 64)]]) }),
        makeLayer({ id: 'bottom', order: 2, pixels: pixelsWith([[0, 0, BLUE]]) }),
        makeLayer({ id: 'middle', order: 1, pixels: pixelsWith([[0, 0, rgba(0, 255, 0, 128)]]) }),
      ];
      expect(computeLayerComposite(layers, [])[0][0]).toEqual(rgba(64, 96, 95, 255));
    });

    it('重なっていないピクセルは各レイヤーの色がそのまま残る', () => {
      const a = makeLayer({ id: 'a', order: 0, pixels: pixelsWith([[1, 1, RED]]) });
      const b = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[2, 2, BLUE]]) });

      const composite = computeLayerComposite([a, b], []);
      expect(composite[1][1]).toEqual(RED);
      expect(composite[2][2]).toEqual(BLUE);
    });
  });

  describe('グループの重ね順', () => {
    it('グループの order が小さいほど前面になり、レイヤーの order より優先される', () => {
      const frontGroup = makeGroup({ id: 'g-front', order: 0 });
      const backGroup = makeGroup({ id: 'g-back', order: 1 });
      // レイヤー単体の order だけ見ると背面側だが、所属グループが前面
      const inFront = makeLayer({
        id: 'in-front',
        groupId: 'g-front',
        order: 5,
        pixels: pixelsWith([[0, 0, RED]]),
      });
      const inBack = makeLayer({
        id: 'in-back',
        groupId: 'g-back',
        order: 0,
        pixels: pixelsWith([[0, 0, BLUE]]),
      });

      expect(computeLayerComposite([inFront, inBack], [frontGroup, backGroup])[0][0]).toEqual(RED);
      expect(computeLayerComposite([inBack, inFront], [backGroup, frontGroup])[0][0]).toEqual(RED);

      // グループの order を入れ替えると結果も入れ替わる
      const swapped = [
        { ...frontGroup, order: 1 },
        { ...backGroup, order: 0 },
      ];
      expect(computeLayerComposite([inFront, inBack], swapped)[0][0]).toEqual(BLUE);
    });

    it('order が同じグループのレイヤーは入り混じらず、配列の後ろのグループがまとめて手前になる', () => {
      const first = makeGroup({ id: 'first', order: 0 });
      const second = makeGroup({ id: 'second', order: 0 });
      // レイヤーの order だけで比べると first のレイヤー（order 0）が手前になる配置
      const inFirst = makeLayer({ id: 'a', groupId: 'first', order: 0, pixels: pixelsWith([[0, 0, RED]]) });
      const inSecond = makeLayer({ id: 'b', groupId: 'second', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });

      expect(computeLayerComposite([inFirst, inSecond], [first, second])[0][0]).toEqual(BLUE);
      expect(computeLayerComposite([inFirst, inSecond], [second, first])[0][0]).toEqual(RED);
    });

    it('同じグループ内ではレイヤーの order で重ね順が決まる', () => {
      const group = makeGroup({ id: 'g', order: 0 });
      const front = makeLayer({ id: 'f', groupId: 'g', order: 0, pixels: pixelsWith([[0, 0, GREEN]]) });
      const back = makeLayer({ id: 'b', groupId: 'g', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });

      expect(computeLayerComposite([back, front], [group])[0][0]).toEqual(GREEN);
    });

    it('グループに属さないレイヤーは、order に関わらずすべてのグループの背面に描画される', () => {
      const group = makeGroup({ id: 'g', order: 100 });
      const grouped = makeLayer({
        id: 'grouped',
        groupId: 'g',
        order: 100,
        pixels: pixelsWith([[0, 0, rgba(255, 0, 0, 128)]]),
      });
      const ungrouped = makeLayer({
        id: 'ungrouped',
        groupId: null,
        order: -10,
        pixels: pixelsWith([[0, 0, BLUE]]),
      });

      // 半透明の赤（グループ内）が前面、不透明な青（グループ外）が背面
      expect(computeLayerComposite([ungrouped, grouped], [group])[0][0]).toEqual(
        rgba(128, 0, 127, 255)
      );
    });

    it('グループに属さないレイヤー同士はレイヤーの order で重ね順が決まる', () => {
      const front = makeLayer({ id: 'f', order: 0, pixels: pixelsWith([[0, 0, GREEN]]) });
      const back = makeLayer({ id: 'b', order: 3, pixels: pixelsWith([[0, 0, BLUE]]) });
      const group = makeGroup({ id: 'g', order: 0 });

      expect(computeLayerComposite([back, front], [group])[0][0]).toEqual(GREEN);
    });

    it('存在しないグループを参照するレイヤーはグループ外として扱われる', () => {
      const group = makeGroup({ id: 'g', order: 0 });
      const grouped = makeLayer({
        id: 'grouped',
        groupId: 'g',
        order: 9,
        pixels: pixelsWith([[0, 0, rgba(255, 0, 0, 128)]]),
      });
      const orphan = makeLayer({
        id: 'orphan',
        groupId: 'missing',
        order: 0,
        pixels: pixelsWith([
          [0, 0, BLUE],
          [1, 0, GREEN],
        ]),
      });

      const composite = computeLayerComposite([orphan, grouped], [group]);
      // 非表示扱いにはならず、グループ内レイヤーの背面に描画される
      expect(composite[0][0]).toEqual(rgba(128, 0, 127, 255));
      expect(composite[0][1]).toEqual(GREEN);
    });
  });

  describe('表示・非表示', () => {
    it('visible が false のレイヤーは描画されない', () => {
      const hidden = makeLayer({
        id: 'hidden',
        order: 0,
        visible: false,
        pixels: pixelsWith([
          [0, 0, RED],
          [1, 0, RED],
        ]),
      });
      const shown = makeLayer({ id: 'shown', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });

      const composite = computeLayerComposite([hidden, shown], []);
      expect(composite[0][0]).toEqual(BLUE);
      expect(composite[0][1]).toEqual(TRANSPARENT);
    });

    it('すべてのレイヤーが非表示なら透明な画像を返す', () => {
      const layers = [
        makeLayer({ id: 'a', visible: false, pixels: filledPixels(RED) }),
        makeLayer({ id: 'b', visible: false, pixels: filledPixels(BLUE) }),
      ];
      expectAllTransparent(computeLayerComposite(layers, []));
    });

    it('非表示グループに属するレイヤーは、レイヤー自体が visible でも描画されない', () => {
      const hiddenGroup = makeGroup({ id: 'hidden-g', order: 0, visible: false });
      const visibleGroup = makeGroup({ id: 'visible-g', order: 1, visible: true });

      const inHidden = makeLayer({
        id: 'in-hidden',
        groupId: 'hidden-g',
        pixels: pixelsWith([
          [0, 0, RED],
          [1, 0, RED],
          [2, 0, RED],
        ]),
      });
      const inVisible = makeLayer({
        id: 'in-visible',
        groupId: 'visible-g',
        pixels: pixelsWith([[0, 0, GREEN]]),
      });
      const ungrouped = makeLayer({ id: 'ungrouped', pixels: pixelsWith([[1, 0, BLUE]]) });

      const composite = computeLayerComposite(
        [inHidden, inVisible, ungrouped],
        [hiddenGroup, visibleGroup]
      );
      // 非表示グループのレイヤーだけが除外され、他のグループやグループ外には影響しない
      expect(composite[0][0]).toEqual(GREEN);
      expect(composite[0][1]).toEqual(BLUE);
      expect(composite[0][2]).toEqual(TRANSPARENT);
    });

    it('表示グループ内でもレイヤー自体が非表示なら描画されない', () => {
      const group = makeGroup({ id: 'g', visible: true });
      const hidden = makeLayer({
        id: 'hidden',
        groupId: 'g',
        visible: false,
        pixels: pixelsWith([[0, 0, RED]]),
      });

      expect(computeLayerComposite([hidden], [group])[0][0]).toEqual(TRANSPARENT);
    });
  });

  describe('レイヤーの不透明度', () => {
    it('opacity 50 の不透明ピクセルは透明な背景に対してアルファ 128 になる', () => {
      const layer = makeLayer({ id: 'l', opacity: 50, pixels: pixelsWith([[0, 0, RED]]) });
      // 255 * 0.5 = 127.5 → 128
      expect(computeLayerComposite([layer], [])[0][0]).toEqual(rgba(255, 0, 0, 128));
    });

    it('opacity は下のレイヤーとの混色に反映される', () => {
      const front = makeLayer({ id: 'f', order: 0, opacity: 50, pixels: pixelsWith([[0, 0, RED]]) });
      const back = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[0, 0, GREEN]]) });

      expect(computeLayerComposite([front, back], [])[0][0]).toEqual(rgba(128, 127, 0, 255));
    });

    it('opacity はピクセル自体のアルファに乗算される', () => {
      const front = makeLayer({
        id: 'f',
        order: 0,
        opacity: 25,
        pixels: pixelsWith([[0, 0, rgba(255, 255, 255, 200)]]),
      });
      const back = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[0, 0, rgba(0, 0, 0, 255)]]) });

      // 実効アルファ = 200 * 0.25 = 50 → 255 * 50/255 = 50
      expect(computeLayerComposite([front, back], [])[0][0]).toEqual(rgba(50, 50, 50, 255));
    });

    it('opacity 0 のレイヤーは何も描画しない', () => {
      const invisible = makeLayer({
        id: 'zero',
        order: 0,
        opacity: 0,
        pixels: pixelsWith([
          [0, 0, RED],
          [1, 0, RED],
        ]),
      });
      const back = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[0, 0, rgba(0, 0, 255, 128)]]) });

      const composite = computeLayerComposite([invisible, back], []);
      expect(composite[0][0]).toEqual(rgba(0, 0, 255, 128));
      expect(composite[0][1]).toEqual(TRANSPARENT);
    });

    it('opacity 100 は不透明度を適用しない場合と同じ結果になる', () => {
      const pixels = pixelsWith([[0, 0, rgba(255, 0, 0, 128)]]);
      const back = makeLayer({ id: 'b', order: 1, pixels: pixelsWith([[0, 0, BLUE]]) });

      expect(
        computeLayerComposite([makeLayer({ id: 'f', order: 0, opacity: 100, pixels }), back], [])[0][0]
      ).toEqual(rgba(128, 0, 127, 255));
    });

    it('opacity が未設定（古いデータ）の場合は 100% として扱う', () => {
      const legacy = makeLayer({ id: 'legacy', pixels: pixelsWith([[0, 0, RED]]) });
      delete (legacy as Partial<Layer>).opacity;

      expect(computeLayerComposite([legacy], [])[0][0]).toEqual(RED);
    });

    it('不透明度の異なる複数レイヤーを混在させても、それぞれの opacity が正しく適用される', () => {
      const layers = [
        makeLayer({ id: 'top', order: 0, opacity: 25, pixels: pixelsWith([[0, 0, rgba(255, 0, 0, 255)]]) }),
        makeLayer({ id: 'mid', order: 1, opacity: 100, pixels: pixelsWith([[0, 0, rgba(0, 255, 0, 128)]]) }),
        makeLayer({ id: 'bottom', order: 2, opacity: 100, pixels: pixelsWith([[0, 0, BLUE]]) }),
      ];
      // top の実効アルファ = round(255 * 0.25) = 64 → 3 枚重ねの期待値と一致する
      expect(computeLayerComposite(layers, [])[0][0]).toEqual(rgba(64, 96, 95, 255));
    });
  });
});

// ---- rgbaEqual ----

describe('rgbaEqual', () => {
  it('両方 null なら等しい', () => {
    expect(rgbaEqual(null, null)).toBe(true);
  });

  it('片方だけ null なら等しくない（透明色と null も区別される）', () => {
    expect(rgbaEqual(null, RED)).toBe(false);
    expect(rgbaEqual(RED, null)).toBe(false);
    expect(rgbaEqual(null, TRANSPARENT)).toBe(false);
    expect(rgbaEqual(TRANSPARENT, null)).toBe(false);
  });

  it('同じ値なら別オブジェクトでも等しい', () => {
    expect(rgbaEqual(rgba(1, 2, 3, 4), rgba(1, 2, 3, 4))).toBe(true);
    expect(rgbaEqual(RED, RED)).toBe(true);
  });

  it.each(['r', 'g', 'b', 'a'] as const)('%s チャンネルだけが異なる場合は等しくない', (channel) => {
    const base = rgba(10, 20, 30, 40);
    const other = { ...base, [channel]: base[channel] + 1 };
    expect(rgbaEqual(base, other)).toBe(false);
    expect(rgbaEqual(other, base)).toBe(false);
  });

  it('アルファ 0 同士でも色成分が異なれば等しくない（厳密比較）', () => {
    expect(rgbaEqual(rgba(255, 0, 0, 0), rgba(0, 0, 0, 0))).toBe(false);
  });
});

describe('sortFrontToBack', () => {
  it('order の小さい順（手前から）に並べ、同じ order は配列の後ろのものを先にする', () => {
    const items = [
      { id: 'a', order: 1 },
      { id: 'b', order: 0 },
      { id: 'c', order: 1 },
      { id: 'd', order: 0 },
    ];
    expect(sortFrontToBack(items).map((i) => i.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('元の配列を変更しない', () => {
    const items = [{ order: 2 }, { order: 1 }];
    sortFrontToBack(items);
    expect(items.map((i) => i.order)).toEqual([2, 1]);
  });
});

describe('groupRanks', () => {
  it('グループ ID → 重なりの順位（手前が 0）を返し、order が同じでも順位は重ならない', () => {
    const ranks = groupRanks([
      makeGroup({ id: 'g1', order: 5 }),
      makeGroup({ id: 'g2', order: 2 }),
      makeGroup({ id: 'g3', order: 5 }),
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ g2: 0, g3: 1, g1: 2 });
  });
});
