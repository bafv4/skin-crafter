// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  type Layer,
  type LayerPixels,
  type RGBA,
  SKIN_HEIGHT,
  SKIN_WIDTH,
} from '../types/editor';

// skinRenderer はオフスクリーンキャンバス・グリッド・市松模様をモジュール内にキャッシュするため、
// テストごとにモジュールを読み込み直してキャッシュの影響を切り離す
type Renderer = typeof import('./skinRenderer');
let renderer: Renderer;

beforeEach(async () => {
  vi.resetModules();
  renderer = await import('./skinRenderer');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- 偽の CanvasRenderingContext2D ----

interface DrawCall {
  op: string;
  args: unknown[];
  // 呼び出し時点の描画状態
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  imageSmoothingEnabled: boolean;
}

interface FakeImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// 描画命令と、その時点の fillStyle などを記録するだけのコンテキスト
class FakeContext2D {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  imageSmoothingEnabled = true;
  readonly calls: DrawCall[] = [];
  // getImageData が返す値（loadSkinFromFile 用）
  imageDataToReturn: FakeImageData = {
    width: SKIN_WIDTH,
    height: SKIN_HEIGHT,
    data: new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4),
  };

  private record(op: string, args: unknown[]): void {
    this.calls.push({
      op,
      args,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      imageSmoothingEnabled: this.imageSmoothingEnabled,
    });
  }

  createImageData(width: number, height: number): FakeImageData {
    this.record('createImageData', [width, height]);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  getImageData(...args: unknown[]): FakeImageData {
    this.record('getImageData', args);
    return this.imageDataToReturn;
  }
  putImageData(...args: unknown[]): void { this.record('putImageData', args); }
  drawImage(...args: unknown[]): void { this.record('drawImage', args); }
  fillRect(...args: unknown[]): void { this.record('fillRect', args); }
  save(): void { this.record('save', []); }
  restore(): void { this.record('restore', []); }
  scale(...args: unknown[]): void { this.record('scale', args); }
  beginPath(): void { this.record('beginPath', []); }
  moveTo(...args: unknown[]): void { this.record('moveTo', args); }
  lineTo(...args: unknown[]): void { this.record('lineTo', args); }
  stroke(): void { this.record('stroke', []); }

  ops(op: string): DrawCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  asCtx(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
}

// 偽の canvas 要素（getContext が偽コンテキスト、または null を返す）
class FakeCanvas {
  width = 300;
  height = 150;
  readonly context: FakeContext2D | null;
  blobToReturn: Blob | null = new Blob(['png'], { type: 'image/png' });
  readonly toBlobTypes: Array<string | undefined> = [];

  constructor(withContext: boolean) {
    this.context = withContext ? new FakeContext2D() : null;
  }

  getContext(type: string): FakeContext2D | null {
    return type === '2d' ? this.context : null;
  }

  toBlob(callback: (blob: Blob | null) => void, type?: string): void {
    this.toBlobTypes.push(type);
    const blob = this.blobToReturn;
    queueMicrotask(() => callback(blob));
  }
}

interface CanvasFactoryOptions {
  // false にすると jsdom（canvas パッケージなし）と同様に getContext が null を返す
  withContext: boolean;
  blob?: Blob | null;
}

// document.createElement('canvas') を偽キャンバスに差し替え、生成されたものを記録する
function installCanvasFactory(options: CanvasFactoryOptions): FakeCanvas[] {
  const created: FakeCanvas[] = [];
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string, elementOptions?: ElementCreationOptions): HTMLElement => {
      if (tagName.toLowerCase() === 'canvas') {
        const canvas = new FakeCanvas(options.withContext);
        if (options.blob !== undefined) canvas.blobToReturn = options.blob;
        created.push(canvas);
        return canvas as unknown as HTMLElement;
      }
      return originalCreateElement(tagName, elementOptions);
    }
  );
  return created;
}

// グローバルの OffscreenCanvas を偽物に差し替え、生成されたものを記録する
function stubOffscreenCanvas(): FakeCanvas[] {
  const created: FakeCanvas[] = [];
  class FakeOffscreenCanvas extends FakeCanvas {
    constructor(width: number, height: number) {
      super(true);
      this.width = width;
      this.height = height;
      created.push(this);
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return created;
}

// ---- 描画結果を取り出すヘルパー ----

interface PaintedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

// (0, 0) への drawImage でキャッシュキャンバスを転写している場合は、その中身を展開して返す
function expandedSource(call: DrawCall): FakeContext2D | null {
  const [source, dx, dy] = call.args;
  if (call.args.length === 3 && dx === 0 && dy === 0 && source instanceof FakeCanvas) {
    return source.context;
  }
  return null;
}

// 対象コンテキストに（キャッシュ経由も含めて）塗られた矩形の一覧
function paintedRects(ctx: FakeContext2D): PaintedRect[] {
  const result: PaintedRect[] = [];
  for (const call of ctx.calls) {
    if (call.op === 'fillRect') {
      const [x, y, w, h] = call.args as number[];
      result.push({ x, y, w, h, color: call.fillStyle });
    } else if (call.op === 'drawImage') {
      const source = expandedSource(call);
      if (source) result.push(...paintedRects(source));
    }
  }
  return result;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  lineWidth: number;
}

// 対象コンテキストに（キャッシュ経由も含めて）引かれた線分の一覧
function strokedSegments(ctx: FakeContext2D): Segment[] {
  const result: Segment[] = [];
  let path: Array<[number, number, number, number]> = [];
  let current: [number, number] | null = null;
  for (const call of ctx.calls) {
    const [a, b] = call.args as number[];
    switch (call.op) {
      case 'beginPath':
        path = [];
        current = null;
        break;
      case 'moveTo':
        current = [a, b];
        break;
      case 'lineTo':
        if (current) path.push([current[0], current[1], a, b]);
        current = [a, b];
        break;
      case 'stroke':
        for (const [x1, y1, x2, y2] of path) {
          result.push({ x1, y1, x2, y2, color: call.strokeStyle, lineWidth: call.lineWidth });
        }
        break;
      case 'drawImage': {
        const source = expandedSource(call);
        if (source) result.push(...strokedSegments(source));
        break;
      }
    }
  }
  return result;
}

const segmentKey = (s: Pick<Segment, 'x1' | 'y1' | 'x2' | 'y2'>) => `${s.x1},${s.y1}-${s.x2},${s.y2}`;

// 64x64 スキン全体に引かれるべきグリッド線（縦 65 本・横 65 本）
function expectedGridKeys(scale: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i <= SKIN_WIDTH; i++) {
    keys.push(segmentKey({ x1: i * scale, y1: 0, x2: i * scale, y2: SKIN_HEIGHT * scale }));
  }
  for (let i = 0; i <= SKIN_HEIGHT; i++) {
    keys.push(segmentKey({ x1: 0, y1: i * scale, x2: SKIN_WIDTH * scale, y2: i * scale }));
  }
  return keys.sort();
}

// 塗られた矩形を「セル座標 → 色」の表にする（セルは cellSize 単位）
function cellColorMap(rects: PaintedRect[], cellSize: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rects) {
    map.set(`${r.x / cellSize},${r.y / cellSize}`, r.color);
  }
  return map;
}

// ---- テストデータ ----

function makeComposite(colorAt: (x: number, y: number) => RGBA): RGBA[][] {
  return Array.from({ length: SKIN_HEIGHT }, (_, y) =>
    Array.from({ length: SKIN_WIDTH }, (_, x) => colorAt(x, y))
  );
}

// 座標ごとに値が異なる模様（透明ピクセルや半透明ピクセルも含む）
const patternColor = (x: number, y: number): RGBA => ({
  r: x * 4,
  g: y * 4,
  b: (x * 7 + y * 13) % 256,
  a: (x + y) % 3 === 0 ? 0 : (x * 5 + y) % 256,
});

// 行優先・RGBA 順に並べた期待バッファ
function expectedBuffer(composite: RGBA[][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  let i = 0;
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const p = composite[y][x];
      data[i++] = p.r;
      data[i++] = p.g;
      data[i++] = p.b;
      data[i++] = p.a;
    }
  }
  return data;
}

function emptyPixels(): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () =>
    Array.from({ length: SKIN_WIDTH }, () => null as RGBA | null)
  );
}

function makeLayer(pixels: LayerPixels): Layer {
  return {
    id: 'layer-1',
    name: 'テストレイヤー',
    baseColor: { r: 255, g: 0, b: 0, a: 255 },
    noiseSettings: { brightness: 0, hue: 0 },
    groupId: null,
    order: 0,
    layerType: 'direct',
    visible: true,
    opacity: 100,
    pixels,
  };
}

// ============================================================

describe('CHECKER_COLORS', () => {
  const hexToLuminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
  };

  it('ライト・ダークそれぞれ #rrggbb 形式の2色で、2色は互いに異なる', () => {
    for (const variant of ['light', 'dark'] as const) {
      const colors = renderer.CHECKER_COLORS[variant];
      expect(colors).toHaveLength(2);
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors[0]).not.toBe(colors[1]);
    }
  });

  it('ダークの配色はどちらの色もライトの配色より暗い', () => {
    const lightMin = Math.min(...renderer.CHECKER_COLORS.light.map(hexToLuminance));
    const darkMax = Math.max(...renderer.CHECKER_COLORS.dark.map(hexToLuminance));
    expect(darkMax).toBeLessThan(lightMin);
  });
});

describe('getPixelFromMouse', () => {
  interface Rect { left: number; top: number }

  // getBoundingClientRect だけを持つ偽キャンバス
  function fakeCanvasAt(...rects: Rect[]) {
    const queue = [...rects];
    let last = rects[0];
    const getBoundingClientRect = vi.fn(() => {
      last = queue.shift() ?? last;
      const width = SKIN_WIDTH * 8;
      const height = SKIN_HEIGHT * 8;
      return {
        left: last.left,
        top: last.top,
        x: last.left,
        y: last.top,
        right: last.left + width,
        bottom: last.top + height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const canvas = { getBoundingClientRect } as unknown as HTMLCanvasElement;
    return { canvas, getBoundingClientRect };
  }

  const mouse = (clientX: number, clientY: number) =>
    new MouseEvent('mousemove', { clientX, clientY });

  it('キャンバス左上からの相対位置を scale で割り、切り捨てたピクセル座標を返す', () => {
    const { canvas } = fakeCanvasAt({ left: 100, top: 50 });
    // x: (100 + 3*8 + 7.9 - 100) / 8 = 3.98… → 3、y: (50 + 5*8 - 50) / 8 = 5
    expect(renderer.getPixelFromMouse(mouse(100 + 3 * 8 + 7.9, 50 + 5 * 8), canvas, 8)).toEqual({ x: 3, y: 5 });
  });

  it('キャンバス左上の角は (0, 0)', () => {
    const { canvas } = fakeCanvasAt({ left: 100, top: 50 });
    expect(renderer.getPixelFromMouse(mouse(100, 50), canvas, 8)).toEqual({ x: 0, y: 0 });
  });

  it('スキン右下の最後のピクセル (63, 63) まで取得できる', () => {
    const { canvas } = fakeCanvasAt({ left: 100, top: 50 });
    const edge = SKIN_WIDTH * 8 - 0.01;
    expect(renderer.getPixelFromMouse(mouse(100 + edge, 50 + edge), canvas, 8)).toEqual({ x: 63, y: 63 });
  });

  it.each([
    ['右端ちょうど（x = 64）', 100 + SKIN_WIDTH * 8, 60],
    ['下端ちょうど（y = 64）', 110, 50 + SKIN_HEIGHT * 8],
    ['右にはみ出し', 100 + SKIN_WIDTH * 8 + 40, 60],
    ['下にはみ出し', 110, 50 + SKIN_HEIGHT * 8 + 40],
    ['左に 1 ピクセル未満はみ出し', 100 - 0.5, 60],
    ['上に 1 ピクセル未満はみ出し', 110, 50 - 0.1],
    ['左に大きくはみ出し', 0, 60],
    ['上に大きくはみ出し', 110, 0],
  ])('スキンの範囲外（%s）は null を返す', (_label, clientX, clientY) => {
    const { canvas } = fakeCanvasAt({ left: 100, top: 50 });
    expect(renderer.getPixelFromMouse(mouse(clientX, clientY), canvas, 8)).toBeNull();
  });

  it.each([
    [4, { x: 25, y: 10 }],
    [8, { x: 12, y: 5 }],
    [16, { x: 6, y: 2 }],
    [32, { x: 3, y: 1 }],
  ])('scale=%i のとき、同じマウス位置 (100, 42) は %o になる', (scale, expected) => {
    const { canvas } = fakeCanvasAt({ left: 0, top: 0 });
    expect(renderer.getPixelFromMouse(mouse(100, 42), canvas, scale)).toEqual(expected);
  });

  it('小数の scale でも切り捨てて整数座標を返す', () => {
    const { canvas } = fakeCanvasAt({ left: 0, top: 0 });
    // 7.4 / 2.5 = 2.96 → 2、12.5 / 2.5 = 5
    expect(renderer.getPixelFromMouse(mouse(7.4, 12.5), canvas, 2.5)).toEqual({ x: 2, y: 5 });
  });

  it('React の MouseEvent（clientX / clientY を持つオブジェクト）も受け付ける', () => {
    const { canvas } = fakeCanvasAt({ left: 10, top: 20 });
    const reactEvent = { clientX: 10 + 8 * 8, clientY: 20 + 2 * 8 + 1 } as unknown as ReactMouseEvent;
    expect(renderer.getPixelFromMouse(reactEvent, canvas, 8)).toEqual({ x: 8, y: 2 });
  });

  it('呼び出しのたびにキャンバスの位置を取得し直し、パンやスクロールによる移動を反映する', () => {
    const { canvas, getBoundingClientRect } = fakeCanvasAt({ left: 0, top: 0 }, { left: 80, top: 40 });
    const event = mouse(100, 60);
    expect(renderer.getPixelFromMouse(event, canvas, 8)).toEqual({ x: 12, y: 7 });
    // キャンバスが右下に移動した後は、同じマウス位置でも別のピクセルになる
    expect(renderer.getPixelFromMouse(event, canvas, 8)).toEqual({ x: 2, y: 2 });
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
  });
});

describe('drawLayerHighlight', () => {
  it('アルファが 0 より大きいピクセルだけを scale 倍の矩形で塗る', () => {
    const pixels = emptyPixels();
    pixels[0][0] = { r: 255, g: 0, b: 0, a: 255 };
    pixels[5][3] = { r: 0, g: 0, b: 0, a: 128 };
    pixels[63][63] = { r: 1, g: 2, b: 3, a: 1 }; // ほぼ透明でもハイライト対象
    pixels[10][20] = { r: 255, g: 255, b: 255, a: 0 }; // 完全に透明なピクセルは対象外
    const ctx = new FakeContext2D();

    renderer.drawLayerHighlight(ctx.asCtx(), makeLayer(pixels), 8);

    const rects = paintedRects(ctx).map(({ x, y, w, h }) => [x, y, w, h]);
    expect(rects).toHaveLength(3);
    expect(rects).toEqual(
      expect.arrayContaining([
        [0, 0, 8, 8],
        [3 * 8, 5 * 8, 8, 8],
        [63 * 8, 63 * 8, 8, 8],
      ])
    );
  });

  it('デフォルトではピクセル自体の色に関係なく半透明の黄色で塗る', () => {
    const pixels = emptyPixels();
    pixels[1][1] = { r: 255, g: 0, b: 0, a: 255 };
    pixels[2][2] = { r: 0, g: 0, b: 255, a: 255 };
    const ctx = new FakeContext2D();

    renderer.drawLayerHighlight(ctx.asCtx(), makeLayer(pixels), 4);

    const colors = paintedRects(ctx).map((r) => r.color);
    expect(colors).toEqual(['rgba(255, 255, 0, 0.5)', 'rgba(255, 255, 0, 0.5)']);
  });

  it('色を指定するとその色で塗る', () => {
    const pixels = emptyPixels();
    pixels[7][9] = { r: 10, g: 20, b: 30, a: 255 };
    const ctx = new FakeContext2D();

    renderer.drawLayerHighlight(ctx.asCtx(), makeLayer(pixels), 16, 'rgba(0, 128, 255, 0.4)');

    expect(paintedRects(ctx)).toEqual([{ x: 9 * 16, y: 7 * 16, w: 16, h: 16, color: 'rgba(0, 128, 255, 0.4)' }]);
  });

  it('何も描かれていないレイヤーでは何も塗らない', () => {
    const ctx = new FakeContext2D();
    renderer.drawLayerHighlight(ctx.asCtx(), makeLayer(emptyPixels()), 8);
    expect(ctx.ops('fillRect')).toHaveLength(0);
  });

  it('全面が塗られたレイヤーでは 64x64 すべてのピクセルを塗る', () => {
    const pixels = emptyPixels().map((row) => row.map(() => ({ r: 0, g: 0, b: 0, a: 255 })));
    const ctx = new FakeContext2D();

    renderer.drawLayerHighlight(ctx.asCtx(), makeLayer(pixels), 4);

    const rects = paintedRects(ctx);
    expect(rects).toHaveLength(SKIN_WIDTH * SKIN_HEIGHT);
    expect(new Set(rects.map((r) => `${r.x},${r.y}`)).size).toBe(SKIN_WIDTH * SKIN_HEIGHT);
  });
});

describe('renderSkinToCanvas', () => {
  it('scale=1 では合成結果を行優先・RGBA 順の ImageData にして (0, 0) へそのまま書き込む', () => {
    const composite = makeComposite(patternColor);
    const ctx = new FakeContext2D();

    renderer.renderSkinToCanvas(ctx.asCtx(), composite);

    expect(ctx.ops('createImageData').map((c) => c.args)).toEqual([[SKIN_WIDTH, SKIN_HEIGHT]]);
    const puts = ctx.ops('putImageData');
    expect(puts).toHaveLength(1);
    const [imageData, dx, dy] = puts[0].args as [FakeImageData, number, number];
    expect([dx, dy]).toEqual([0, 0]);
    expect(imageData.data).toEqual(expectedBuffer(composite));

    // 並び順の確認（(1,0) は 2 番目、(0,1) は 65 番目、(63,63) は最後のピクセル）
    const at = (i: number) => Array.from(imageData.data.slice(i * 4, i * 4 + 4));
    expect(at(1)).toEqual([4, 0, 7, 5]);
    expect(at(SKIN_WIDTH)).toEqual([0, 4, 13, 1]);
    expect(at(SKIN_WIDTH * SKIN_HEIGHT - 1)).toEqual([252, 252, (63 * 7 + 63 * 13) % 256, 0]);

    // 等倍では拡大描画は行わない
    expect(ctx.ops('drawImage')).toHaveLength(0);
  });

  it('透明ピクセルの RGB 値もアルファを掛けずにそのまま書き込む', () => {
    const composite = makeComposite(() => ({ r: 10, g: 20, b: 30, a: 0 }));
    const ctx = new FakeContext2D();

    renderer.renderSkinToCanvas(ctx.asCtx(), composite, 1);

    const [imageData] = ctx.ops('putImageData')[0].args as [FakeImageData];
    expect(Array.from(imageData.data.slice(0, 8))).toEqual([10, 20, 30, 0, 10, 20, 30, 0]);
  });

  it('scale>1 では OffscreenCanvas に等倍で書き込み、スムージングなしで scale 倍に拡大して描画する', () => {
    const offscreens = stubOffscreenCanvas();
    const composite = makeComposite(patternColor);
    const ctx = new FakeContext2D();

    renderer.renderSkinToCanvas(ctx.asCtx(), composite, 8);

    expect(offscreens).toHaveLength(1);
    const offscreen = offscreens[0];
    expect([offscreen.width, offscreen.height]).toEqual([SKIN_WIDTH, SKIN_HEIGHT]);

    const offscreenPuts = offscreen.context!.ops('putImageData');
    expect(offscreenPuts).toHaveLength(1);
    const [imageData, dx, dy] = offscreenPuts[0].args as [FakeImageData, number, number];
    expect([dx, dy]).toEqual([0, 0]);
    expect(imageData.data).toEqual(expectedBuffer(composite));

    // 対象へは拡大した drawImage のみ（ピクセルの直接書き込みはしない）
    expect(ctx.ops('putImageData')).toHaveLength(0);
    const draws = ctx.ops('drawImage');
    expect(draws).toHaveLength(1);
    expect(draws[0].args).toEqual([offscreen, 0, 0, SKIN_WIDTH * 8, SKIN_HEIGHT * 8]);
    expect(draws[0].imageSmoothingEnabled).toBe(false);
  });

  it('OffscreenCanvas がない環境では 64x64 の canvas 要素をオフスクリーンとして使う', () => {
    const canvases = installCanvasFactory({ withContext: true });
    const composite = makeComposite(patternColor);
    const ctx = new FakeContext2D();

    renderer.renderSkinToCanvas(ctx.asCtx(), composite, 16);

    expect(canvases).toHaveLength(1);
    const offscreen = canvases[0];
    expect([offscreen.width, offscreen.height]).toEqual([SKIN_WIDTH, SKIN_HEIGHT]);
    const [imageData] = offscreen.context!.ops('putImageData')[0].args as [FakeImageData];
    expect(imageData.data).toEqual(expectedBuffer(composite));

    const draws = ctx.ops('drawImage');
    expect(draws).toHaveLength(1);
    expect(draws[0].args).toEqual([offscreen, 0, 0, SKIN_WIDTH * 16, SKIN_HEIGHT * 16]);
    expect(draws[0].imageSmoothingEnabled).toBe(false);
  });

  it('オフスクリーンキャンバスは使い回し、2 回目以降は最新の合成結果を描画する', () => {
    const offscreens = stubOffscreenCanvas();
    const first = makeComposite(() => ({ r: 255, g: 0, b: 0, a: 255 }));
    const second = makeComposite(patternColor);
    const ctx = new FakeContext2D();

    renderer.renderSkinToCanvas(ctx.asCtx(), first, 8);
    renderer.renderSkinToCanvas(ctx.asCtx(), second, 4);

    expect(offscreens).toHaveLength(1);
    const puts = offscreens[0].context!.ops('putImageData');
    expect(puts).toHaveLength(2);
    expect((puts[1].args[0] as FakeImageData).data).toEqual(expectedBuffer(second));

    const draws = ctx.ops('drawImage');
    expect(draws.map((d) => d.args)).toEqual([
      [offscreens[0], 0, 0, SKIN_WIDTH * 8, SKIN_HEIGHT * 8],
      [offscreens[0], 0, 0, SKIN_WIDTH * 4, SKIN_HEIGHT * 4],
    ]);
  });
});

describe('drawCheckerboard', () => {
  const [LIGHT1, LIGHT2] = ['#ffffff', '#cccccc'];

  describe('キャッシュ用キャンバスが使えない環境（jsdom と同様に getContext が null）', () => {
    beforeEach(() => {
      installCanvasFactory({ withContext: false });
    });

    it('デフォルトはライト配色・セルサイズ 4 で、左上から2色が交互に並ぶ', () => {
      const ctx = new FakeContext2D();

      renderer.drawCheckerboard(ctx.asCtx(), 16, 8, 1);

      expect(paintedRects(ctx)).toEqual([
        { x: 0, y: 0, w: 4, h: 4, color: LIGHT1 },
        { x: 4, y: 0, w: 4, h: 4, color: LIGHT2 },
        { x: 8, y: 0, w: 4, h: 4, color: LIGHT1 },
        { x: 12, y: 0, w: 4, h: 4, color: LIGHT2 },
        { x: 0, y: 4, w: 4, h: 4, color: LIGHT2 },
        { x: 4, y: 4, w: 4, h: 4, color: LIGHT1 },
        { x: 8, y: 4, w: 4, h: 4, color: LIGHT2 },
        { x: 12, y: 4, w: 4, h: 4, color: LIGHT1 },
      ]);
    });

    it('デフォルトの配色は CHECKER_COLORS.light と一致する', () => {
      const ctx = new FakeContext2D();
      renderer.drawCheckerboard(ctx.asCtx(), 8, 8, 1);
      expect(new Set(paintedRects(ctx).map((r) => r.color))).toEqual(new Set(renderer.CHECKER_COLORS.light));
    });

    it('セルの一辺は size × scale になり、隣り合うセルは必ず異なる色になる', () => {
      const [c1, c2] = renderer.CHECKER_COLORS.dark;
      const scale = 8;
      const size = 2;
      const cell = size * scale;
      const width = SKIN_WIDTH * scale;
      const height = SKIN_HEIGHT * scale;
      const ctx = new FakeContext2D();

      renderer.drawCheckerboard(ctx.asCtx(), width, height, scale, size, c1, c2);

      const rects = paintedRects(ctx);
      expect(rects).toHaveLength((width / cell) * (height / cell));
      for (const r of rects) {
        expect([r.w, r.h]).toEqual([cell, cell]);
        expect(r.x % cell).toBe(0);
        expect(r.y % cell).toBe(0);
      }

      const map = cellColorMap(rects, cell);
      expect(map.get('0,0')).toBe(c1);
      for (let cy = 0; cy < height / cell; cy++) {
        for (let cx = 0; cx < width / cell; cx++) {
          const color = map.get(`${cx},${cy}`);
          expect([c1, c2]).toContain(color);
          if (cx > 0) expect(map.get(`${cx - 1},${cy}`)).not.toBe(color);
          if (cy > 0) expect(map.get(`${cx},${cy - 1}`)).not.toBe(color);
        }
      }
    });

    it('幅・高さがセルサイズで割り切れなくても、端まで隙間なく覆う', () => {
      const ctx = new FakeContext2D();

      renderer.drawCheckerboard(ctx.asCtx(), 10, 6, 1, 4);

      const rects = paintedRects(ctx);
      // x: 0, 4, 8 の 3 列 × y: 0, 4 の 2 行（最後の列・行ははみ出した分がクリップされる）
      expect(rects.map((r) => [r.x, r.y])).toEqual([
        [0, 0], [4, 0], [8, 0],
        [0, 4], [4, 4], [8, 4],
      ]);
      expect(Math.max(...rects.map((r) => r.x + r.w))).toBeGreaterThanOrEqual(10);
      expect(Math.max(...rects.map((r) => r.y + r.h))).toBeGreaterThanOrEqual(6);
      // 描画範囲の外から始まるセルはない
      for (const r of rects) {
        expect(r.x).toBeLessThan(10);
        expect(r.y).toBeLessThan(6);
      }
    });

    it('配色を変えて呼ぶと、その呼び出しで指定した色で描く', () => {
      const [d1, d2] = renderer.CHECKER_COLORS.dark;
      const ctx = new FakeContext2D();

      renderer.drawCheckerboard(ctx.asCtx(), 8, 8, 1, 4);
      const firstCount = ctx.ops('fillRect').length;
      renderer.drawCheckerboard(ctx.asCtx(), 8, 8, 1, 4, d1, d2);

      const secondRects = paintedRects(ctx).slice(firstCount);
      expect(cellColorMap(secondRects, 4)).toEqual(
        new Map([
          ['0,0', d1],
          ['1,0', d2],
          ['0,1', d2],
          ['1,1', d1],
        ])
      );
    });
  });

  describe('キャッシュ用キャンバスが使える環境', () => {
    let canvases: FakeCanvas[];

    beforeEach(() => {
      canvases = installCanvasFactory({ withContext: true });
    });

    it('描画範囲と同じ大きさのキャッシュに描き、対象へは (0, 0) に転写する', () => {
      const ctx = new FakeContext2D();

      renderer.drawCheckerboard(ctx.asCtx(), 16, 8, 1);

      expect(canvases).toHaveLength(1);
      expect([canvases[0].width, canvases[0].height]).toEqual([16, 8]);
      // 対象に直接セルを塗るのではなく、キャッシュを 1 回転写するだけ
      expect(ctx.ops('fillRect')).toHaveLength(0);
      expect(ctx.ops('drawImage').map((d) => d.args)).toEqual([[canvases[0], 0, 0]]);
      // 転写された内容は正しい市松模様になっている
      expect(cellColorMap(paintedRects(ctx), 4)).toEqual(
        new Map([
          ['0,0', LIGHT1], ['1,0', LIGHT2], ['2,0', LIGHT1], ['3,0', LIGHT2],
          ['0,1', LIGHT2], ['1,1', LIGHT1], ['2,1', LIGHT2], ['3,1', LIGHT1],
        ])
      );
    });

    it('同じ引数で再描画するとキャッシュを再利用し、描き直さない', () => {
      const ctx = new FakeContext2D();

      renderer.drawCheckerboard(ctx.asCtx(), 64, 64, 2, 2);
      const cellsDrawn = canvases[0].context!.ops('fillRect').length;
      renderer.drawCheckerboard(ctx.asCtx(), 64, 64, 2, 2);

      expect(canvases).toHaveLength(1);
      expect(canvases[0].context!.ops('fillRect')).toHaveLength(cellsDrawn);
      expect(ctx.ops('drawImage').map((d) => d.args)).toEqual([
        [canvases[0], 0, 0],
        [canvases[0], 0, 0],
      ]);
    });

    it('配色を変えるとキャッシュを使わず新しい色で描き直す', () => {
      const [d1, d2] = renderer.CHECKER_COLORS.dark;
      const light = new FakeContext2D();
      const dark = new FakeContext2D();

      renderer.drawCheckerboard(light.asCtx(), 8, 8, 1, 4);
      renderer.drawCheckerboard(dark.asCtx(), 8, 8, 1, 4, d1, d2);

      expect(canvases).toHaveLength(2);
      expect(new Set(paintedRects(dark).map((r) => r.color))).toEqual(new Set([d1, d2]));
      expect(cellColorMap(paintedRects(dark), 4).get('0,0')).toBe(d1);
    });

    it('片方の色だけを変えた場合も描き直す', () => {
      const first = new FakeContext2D();
      const second = new FakeContext2D();

      renderer.drawCheckerboard(first.asCtx(), 8, 8, 1, 4, '#111111', '#222222');
      renderer.drawCheckerboard(second.asCtx(), 8, 8, 1, 4, '#111111', '#333333');

      expect(canvases).toHaveLength(2);
      expect(new Set(paintedRects(second).map((r) => r.color))).toEqual(new Set(['#111111', '#333333']));
    });

    it('配色を切り替えてから元に戻しても、元の配色で描かれる', () => {
      const [d1, d2] = renderer.CHECKER_COLORS.dark;
      const ctx1 = new FakeContext2D();
      const ctx2 = new FakeContext2D();
      const ctx3 = new FakeContext2D();

      renderer.drawCheckerboard(ctx1.asCtx(), 8, 8, 1, 4);
      renderer.drawCheckerboard(ctx2.asCtx(), 8, 8, 1, 4, d1, d2);
      renderer.drawCheckerboard(ctx3.asCtx(), 8, 8, 1, 4);

      expect(new Set(paintedRects(ctx3).map((r) => r.color))).toEqual(new Set([LIGHT1, LIGHT2]));
    });

    it.each([
      ['幅', [32, 16, 1, 4], { cols: 8, rows: 4, cell: 4 }],
      ['高さ', [16, 32, 1, 4], { cols: 4, rows: 8, cell: 4 }],
      ['scale', [16, 16, 2, 4], { cols: 2, rows: 2, cell: 8 }],
      ['size', [16, 16, 1, 2], { cols: 8, rows: 8, cell: 2 }],
    ] as const)('%s が変わると新しい大きさで描き直す', (_label, args, expected) => {
      const [width, height, scale, size] = args;
      const before = new FakeContext2D();
      const after = new FakeContext2D();

      renderer.drawCheckerboard(before.asCtx(), 16, 16, 1, 4);
      renderer.drawCheckerboard(after.asCtx(), width, height, scale, size);

      expect(canvases).toHaveLength(2);
      expect([canvases[1].width, canvases[1].height]).toEqual([width, height]);
      const rects = paintedRects(after);
      expect(rects).toHaveLength(expected.cols * expected.rows);
      for (const r of rects) expect([r.w, r.h]).toEqual([expected.cell, expected.cell]);
    });
  });
});

describe('drawGrid', () => {
  describe('キャッシュ用キャンバスが使えない環境（jsdom と同様に getContext が null）', () => {
    beforeEach(() => {
      installCanvasFactory({ withContext: false });
    });

    it('対象に直接、スキン全体を覆う縦 65 本・横 65 本の線を引く', () => {
      const ctx = new FakeContext2D();

      renderer.drawGrid(ctx.asCtx(), 8);

      const segments = strokedSegments(ctx);
      expect(segments.map(segmentKey).sort()).toEqual(expectedGridKeys(8));
    });

    it('デフォルトの線は半透明のグレーで、太さ 0.5', () => {
      const ctx = new FakeContext2D();

      renderer.drawGrid(ctx.asCtx(), 4);

      const segments = strokedSegments(ctx);
      expect(segments.length).toBeGreaterThan(0);
      for (const s of segments) {
        expect(s.color).toBe('rgba(128, 128, 128, 0.3)');
        expect(s.lineWidth).toBe(0.5);
      }
    });

    it('色を指定するとその色で線を引く', () => {
      const ctx = new FakeContext2D();

      renderer.drawGrid(ctx.asCtx(), 4, '#ff0000');

      const colors = new Set(strokedSegments(ctx).map((s) => s.color));
      expect(colors).toEqual(new Set(['#ff0000']));
    });
  });

  describe('キャッシュ用キャンバスが使える環境', () => {
    let canvases: FakeCanvas[];

    beforeEach(() => {
      canvases = installCanvasFactory({ withContext: true });
    });

    it('スキン全体の大きさのキャッシュに線を引き、対象へは (0, 0) に転写する', () => {
      const ctx = new FakeContext2D();

      renderer.drawGrid(ctx.asCtx(), 8);

      expect(canvases).toHaveLength(1);
      expect([canvases[0].width, canvases[0].height]).toEqual([SKIN_WIDTH * 8, SKIN_HEIGHT * 8]);
      expect(ctx.ops('stroke')).toHaveLength(0);
      expect(ctx.ops('drawImage').map((d) => d.args)).toEqual([[canvases[0], 0, 0]]);
      expect(strokedSegments(ctx).map(segmentKey).sort()).toEqual(expectedGridKeys(8));
    });

    it('同じ scale で再描画するとキャッシュを再利用し、線を引き直さない', () => {
      const ctx = new FakeContext2D();

      renderer.drawGrid(ctx.asCtx(), 8);
      const strokes = canvases[0].context!.ops('stroke').length;
      renderer.drawGrid(ctx.asCtx(), 8);

      expect(canvases).toHaveLength(1);
      expect(canvases[0].context!.ops('stroke')).toHaveLength(strokes);
      expect(ctx.ops('drawImage').map((d) => d.args)).toEqual([
        [canvases[0], 0, 0],
        [canvases[0], 0, 0],
      ]);
    });

    it('scale を変えると新しい大きさで引き直す', () => {
      const before = new FakeContext2D();
      const after = new FakeContext2D();

      renderer.drawGrid(before.asCtx(), 8);
      renderer.drawGrid(after.asCtx(), 16);

      expect(canvases).toHaveLength(2);
      expect([canvases[1].width, canvases[1].height]).toEqual([SKIN_WIDTH * 16, SKIN_HEIGHT * 16]);
      expect(strokedSegments(after).map(segmentKey).sort()).toEqual(expectedGridKeys(16));
    });

    it('色を変えると新しい色で引き直す（同じ scale でも前の色のキャッシュを使わない）', () => {
      const red = new FakeContext2D();
      const blue = new FakeContext2D();

      renderer.drawGrid(red.asCtx(), 8, 'red');
      renderer.drawGrid(blue.asCtx(), 8, 'blue');

      expect(canvases).toHaveLength(2);
      expect(new Set(strokedSegments(blue).map((seg) => seg.color))).toEqual(new Set(['blue']));
    });
  });
});

describe('canvasToBlob', () => {
  it('PNG 形式で書き出し、得られた Blob で解決する', async () => {
    const canvas = new FakeCanvas(true);
    const blob = new Blob(['data'], { type: 'image/png' });
    canvas.blobToReturn = blob;

    await expect(renderer.canvasToBlob(canvas as unknown as HTMLCanvasElement)).resolves.toBe(blob);
    expect(canvas.toBlobTypes).toEqual(['image/png']);
  });

  it('Blob が得られなかった場合はエラーで reject する', async () => {
    const canvas = new FakeCanvas(true);
    canvas.blobToReturn = null;

    await expect(renderer.canvasToBlob(canvas as unknown as HTMLCanvasElement)).rejects.toThrow('Failed to create blob');
  });
});

describe('downloadSkin', () => {
  const OBJECT_URL = 'blob:http://localhost/skin-object-url';

  // リンクのクリック（ダウンロード開始）時点の href / download を記録する
  function spyDownload() {
    const clicks: Array<{ href: string | null; download: string }> = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ href: this.getAttribute('href'), download: this.download });
      });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(OBJECT_URL);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { clicks, click, createObjectURL, revokeObjectURL };
  }

  it('64x64 のキャンバスに合成結果を等倍で描き、指定のファイル名で PNG をダウンロードさせる', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const canvases = installCanvasFactory({ withContext: true, blob });
    const { clicks, click, createObjectURL, revokeObjectURL } = spyDownload();
    const composite = makeComposite(patternColor);

    await renderer.downloadSkin(composite, 'my-skin.png');

    expect(canvases).toHaveLength(1);
    const canvas = canvases[0];
    expect([canvas.width, canvas.height]).toEqual([SKIN_WIDTH, SKIN_HEIGHT]);
    expect(canvas.toBlobTypes).toEqual(['image/png']);
    const puts = canvas.context!.ops('putImageData');
    expect(puts).toHaveLength(1);
    expect((puts[0].args[0] as FakeImageData).data).toEqual(expectedBuffer(composite));

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{ href: OBJECT_URL, download: 'my-skin.png' }]);
    // クリック後にオブジェクト URL を解放する
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    expect(revokeObjectURL.mock.invocationCallOrder[0]).toBeGreaterThan(click.mock.invocationCallOrder[0]);
  });

  it('ファイル名を省略すると skin.png になる', async () => {
    installCanvasFactory({ withContext: true });
    const { clicks } = spyDownload();

    await renderer.downloadSkin(makeComposite(patternColor));

    expect(clicks).toEqual([{ href: OBJECT_URL, download: 'skin.png' }]);
  });

  it('キャンバスのコンテキストが取得できない場合は reject し、ダウンロードしない', async () => {
    installCanvasFactory({ withContext: false });
    const { click, createObjectURL } = spyDownload();

    await expect(renderer.downloadSkin(makeComposite(patternColor))).rejects.toThrow('Failed to get canvas context');
    expect(click).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('PNG の生成に失敗した場合は reject し、ダウンロードしない', async () => {
    installCanvasFactory({ withContext: true, blob: null });
    const { click, createObjectURL } = spyDownload();

    await expect(renderer.downloadSkin(makeComposite(patternColor))).rejects.toThrow('Failed to create blob');
    expect(click).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('loadSkinFromFile', () => {
  const OBJECT_URL = 'blob:http://localhost/uploaded-skin';

  // src を設定すると非同期に onload / onerror を呼ぶ偽 Image
  function stubImage(outcome: 'load' | 'error', size = { width: 64, height: 64 }) {
    const images: FakeImage[] = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = size.width;
      height = size.height;
      private _src = '';
      constructor() {
        images.push(this);
      }
      get src() {
        return this._src;
      }
      set src(value: string) {
        this._src = value;
        queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()));
      }
    }
    vi.stubGlobal('Image', FakeImage);
    return images;
  }

  function spyObjectUrls() {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(OBJECT_URL);
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { createObjectURL, revokeObjectURL };
  }

  const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'skin.png', { type: 'image/png' });

  it('画像を 64x64 のキャンバスに描き、その ImageData で解決する', async () => {
    const images = stubImage('load');
    const canvases = installCanvasFactory({ withContext: true });
    const { createObjectURL, revokeObjectURL } = spyObjectUrls();
    const file = pngFile();

    const result = await renderer.loadSkinFromFile(file);

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe(OBJECT_URL);

    expect(canvases).toHaveLength(1);
    const canvas = canvases[0];
    expect([canvas.width, canvas.height]).toEqual([SKIN_WIDTH, SKIN_HEIGHT]);
    expect(canvas.context!.ops('drawImage').map((d) => d.args)).toEqual([[images[0], 0, 0, SKIN_WIDTH, SKIN_HEIGHT]]);
    expect(canvas.context!.ops('getImageData').map((d) => d.args)).toEqual([[0, 0, SKIN_WIDTH, SKIN_HEIGHT]]);
    expect(result).toBe(canvas.context!.imageDataToReturn);

    // 読み込みが終わったらオブジェクト URL を解放する
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('64x64 以外の大きさの画像も 64x64 に拡大縮小して描く', async () => {
    const images = stubImage('load', { width: 128, height: 128 });
    const canvases = installCanvasFactory({ withContext: true });
    spyObjectUrls();

    await renderer.loadSkinFromFile(pngFile());

    expect(canvases[0].context!.ops('drawImage').map((d) => d.args)).toEqual([[images[0], 0, 0, SKIN_WIDTH, SKIN_HEIGHT]]);
  });

  it('画像の読み込みに失敗した場合は reject し、オブジェクト URL を解放する', async () => {
    stubImage('error');
    const canvases = installCanvasFactory({ withContext: true });
    const { revokeObjectURL } = spyObjectUrls();

    await expect(renderer.loadSkinFromFile(pngFile())).rejects.toThrow('Failed to load image');
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    expect(canvases).toHaveLength(0);
  });

  it('キャンバスのコンテキストが取得できない場合は reject し、オブジェクト URL を解放する', async () => {
    stubImage('load');
    installCanvasFactory({ withContext: false });
    const { revokeObjectURL } = spyObjectUrls();

    await expect(renderer.loadSkinFromFile(pngFile())).rejects.toThrow('Failed to get canvas context');
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('作成したオブジェクト URL は成功・失敗のどちらでも 1 回だけ解放される', async () => {
    const { createObjectURL, revokeObjectURL } = spyObjectUrls();
    installCanvasFactory({ withContext: true });

    stubImage('load');
    await renderer.loadSkinFromFile(pngFile());
    stubImage('error');
    await renderer.loadSkinFromFile(pngFile()).catch(() => {});

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
