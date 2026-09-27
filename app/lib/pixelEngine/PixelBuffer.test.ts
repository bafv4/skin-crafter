import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUFFER_SIZE, PIXEL_COUNT, PixelBuffer, SKIN_HEIGHT, SKIN_WIDTH } from './PixelBuffer';

// ---- テスト用ヘルパー ----

type Pixel = [number, number, number, number];

// 0 以外のバイト数を数える（意図しない場所への書き込み検出用）
function countNonZeroBytes(buf: PixelBuffer): number {
  let count = 0;
  for (const v of buf.data) if (v !== 0) count++;
  return count;
}

// 不透明（alpha > 0）なピクセルの座標一覧を "x,y" 形式で返す
function paintedCoords(buf: PixelBuffer): string[] {
  const coords: string[] = [];
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      if (buf.getPixel(x, y)[3] !== 0) coords.push(`${x},${y}`);
    }
  }
  return coords;
}

// 矩形 [minX..maxX] x [minY..maxY]（両端含む）の座標一覧
function rectCoords(minX: number, minY: number, maxX: number, maxY: number): string[] {
  const coords: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) coords.push(`${x},${y}`);
  }
  return coords;
}

// 全ピクセルを同じ色で埋める
function fillAll(buf: PixelBuffer, [r, g, b, a]: Pixel): void {
  buf.setPixelRect(0, 0, buf.width - 1, buf.height - 1, r, g, b, a);
}

// 各ピクセルに座標由来の異なる色を置く（コピー系テスト用）
function fillPattern(buf: PixelBuffer): void {
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      buf.setPixel(x, y, x * 4, y * 4, (x + y) % 256, 255 - x);
    }
  }
}

const isLittleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// ---- 定数 ----

describe('PixelBuffer の定数', () => {
  it('スキンは 64x64、RGBA 4 バイト/ピクセル', () => {
    expect(SKIN_WIDTH).toBe(64);
    expect(SKIN_HEIGHT).toBe(64);
    expect(PIXEL_COUNT).toBe(64 * 64);
    expect(BUFFER_SIZE).toBe(64 * 64 * 4);
  });
});

// ---- コンストラクタ ----

describe('PixelBuffer コンストラクタ', () => {
  it('引数なしでは 64x64 の完全透明なバッファを作る', () => {
    const buf = new PixelBuffer();
    expect(buf.width).toBe(SKIN_WIDTH);
    expect(buf.height).toBe(SKIN_HEIGHT);
    expect(buf.data).toBeInstanceOf(Uint8ClampedArray);
    expect(buf.data.length).toBe(BUFFER_SIZE);
    expect(countNonZeroBytes(buf)).toBe(0);
    expect(buf.order).toBe(0);
  });

  it('任意サイズを指定すると width * height * 4 バイトのバッファになる', () => {
    const buf = new PixelBuffer(3, 2);
    expect(buf.width).toBe(3);
    expect(buf.height).toBe(2);
    expect(buf.data.length).toBe(3 * 2 * 4);
  });

  it('data32 は data と同じメモリを共有する 1 ピクセル = 1 要素のビュー', () => {
    const buf = new PixelBuffer();
    expect(buf.data32).toBeInstanceOf(Uint32Array);
    expect(buf.data32.length).toBe(PIXEL_COUNT);
    expect(buf.data32.buffer).toBe(buf.data.buffer);

    buf.setPixel(5, 0, 1, 2, 3, 4);
    expect(buf.data32[5]).not.toBe(0);
    buf.data32[5] = 0;
    expect(buf.getPixel(5, 0)).toEqual([0, 0, 0, 0]);
  });

  it('既存の ArrayBuffer から内容をコピーして作れる', () => {
    const source = new PixelBuffer();
    fillPattern(source);

    const buf = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT, source.getTransferableBuffer());
    expect(Array.from(buf.data)).toEqual(Array.from(source.data));
    expect(buf.getPixel(10, 20)).toEqual(source.getPixel(10, 20));
  });

  it('既存の ArrayBuffer とはメモリを共有しない（双方向に独立）', () => {
    const raw = new Uint8ClampedArray(BUFFER_SIZE);
    raw.set([10, 20, 30, 40], 0);

    const buf = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT, raw.buffer);
    expect(buf.data.buffer).not.toBe(raw.buffer);

    // 元バッファを書き換えても影響しない
    raw.set([99, 99, 99, 99], 0);
    expect(buf.getPixel(0, 0)).toEqual([10, 20, 30, 40]);

    // PixelBuffer を書き換えても元バッファに影響しない
    buf.setPixel(1, 0, 1, 2, 3, 4);
    expect(Array.from(raw.subarray(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it('元の ArrayBuffer が転送（detach）された後でも内容を保持している', () => {
    const raw = new Uint8ClampedArray(BUFFER_SIZE);
    raw.set([1, 2, 3, 255], 4 * 65); // (1, 1)

    const buf = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT, raw.buffer);
    // postMessage の Transferable と同じく元バッファを使用不可にする
    structuredClone(raw.buffer, { transfer: [raw.buffer] });
    expect(raw.buffer.byteLength).toBe(0);

    expect(buf.getPixel(1, 1)).toEqual([1, 2, 3, 255]);
    expect(buf.data.length).toBe(BUFFER_SIZE);
  });
});

// ---- setPixel / getPixel ----

describe('setPixel / getPixel', () => {
  it('設定した RGBA をそのまま取得できる', () => {
    const buf = new PixelBuffer();
    buf.setPixel(12, 34, 200, 100, 50, 128);
    expect(buf.getPixel(12, 34)).toEqual([200, 100, 50, 128]);
  });

  it('データは行優先（row-major）の RGBA 順で並ぶ', () => {
    const buf = new PixelBuffer();
    buf.setPixel(2, 1, 11, 22, 33, 44);

    const i = (1 * SKIN_WIDTH + 2) * 4;
    expect(Array.from(buf.data.subarray(i, i + 4))).toEqual([11, 22, 33, 44]);
  });

  it('行のストライドは width に従う（非正方形バッファ）', () => {
    const buf = new PixelBuffer(3, 2);
    buf.setPixel(1, 1, 5, 6, 7, 8);

    // (y * width + x) * 4 = (1 * 3 + 1) * 4 = 16
    expect(Array.from(buf.data)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 5, 6, 7, 8, 0, 0, 0, 0,
    ]);
  });

  it('対象ピクセル以外は変更しない', () => {
    const buf = new PixelBuffer();
    buf.setPixel(63, 63, 1, 2, 3, 4);
    expect(countNonZeroBytes(buf)).toBe(4);
    expect(paintedCoords(buf)).toEqual(['63,63']);
  });

  it('既存の色はブレンドせずに上書きする（半透明・透明でも置き換え）', () => {
    const buf = new PixelBuffer();
    buf.setPixel(0, 0, 255, 255, 255, 255);

    buf.setPixel(0, 0, 10, 20, 30, 64);
    expect(buf.getPixel(0, 0)).toEqual([10, 20, 30, 64]);

    buf.setPixel(0, 0, 7, 8, 9, 0);
    expect(buf.getPixel(0, 0)).toEqual([7, 8, 9, 0]);
  });

  it('範囲外の色値は 0〜255 にクランプされる', () => {
    const buf = new PixelBuffer();
    buf.setPixel(0, 0, 300, -20, 256, 1000);
    expect(buf.getPixel(0, 0)).toEqual([255, 0, 255, 255]);
  });

  it('未設定のピクセルは (0, 0, 0, 0)', () => {
    const buf = new PixelBuffer();
    expect(buf.getPixel(0, 0)).toEqual([0, 0, 0, 0]);
    expect(buf.getPixel(63, 63)).toEqual([0, 0, 0, 0]);
  });

  it('getPixel の戻り値を書き換えてもバッファには影響しない', () => {
    const buf = new PixelBuffer();
    buf.setPixel(3, 3, 1, 2, 3, 4);
    const px = buf.getPixel(3, 3);
    px[0] = 255;
    expect(buf.getPixel(3, 3)).toEqual([1, 2, 3, 4]);
  });

  it.each([
    ['左端の外 (x = -1)', -1, 10],
    ['右端の外 (x = width)', 64, 10],
    ['上端の外 (y = -1)', 10, -1],
    ['下端の外 (y = height)', 10, 64],
    ['大きく外れた座標', 1000, -1000],
  ])('範囲外座標 %s への setPixel は何もしない', (_label, x, y) => {
    const buf = new PixelBuffer();
    expect(() => buf.setPixel(x, y, 255, 255, 255, 255)).not.toThrow();
    expect(countNonZeroBytes(buf)).toBe(0);
  });

  it('x がはみ出しても隣の行に回り込んで書き込まない', () => {
    const buf = new PixelBuffer();
    // チェックがなければ (64, 0) は (0, 1)、(-1, 1) は (63, 0) と同じ位置になる
    buf.setPixel(64, 0, 255, 0, 0, 255);
    buf.setPixel(-1, 1, 0, 255, 0, 255);
    expect(buf.getPixel(0, 1)).toEqual([0, 0, 0, 0]);
    expect(buf.getPixel(63, 0)).toEqual([0, 0, 0, 0]);
  });

  it.each([
    [-1, 0],
    [64, 0],
    [0, -1],
    [0, 64],
  ])('範囲外座標 (%i, %i) の getPixel は塗られていても (0, 0, 0, 0) を返す', (x, y) => {
    const buf = new PixelBuffer();
    fillAll(buf, [9, 8, 7, 255]);
    expect(buf.getPixel(x, y)).toEqual([0, 0, 0, 0]);
  });
});

// ---- erasePixel ----

describe('erasePixel', () => {
  it('指定ピクセルを (0, 0, 0, 0) にし、他のピクセルは残す', () => {
    const buf = new PixelBuffer();
    buf.setPixel(4, 4, 10, 20, 30, 255);
    buf.setPixel(5, 4, 40, 50, 60, 255);

    buf.erasePixel(4, 4);

    expect(buf.getPixel(4, 4)).toEqual([0, 0, 0, 0]);
    expect(buf.getPixel(5, 4)).toEqual([40, 50, 60, 255]);
  });

  it('RGB 成分も 0 にリセットされる（アルファだけでなく）', () => {
    const buf = new PixelBuffer();
    buf.setPixel(0, 0, 200, 150, 100, 50);
    buf.erasePixel(0, 0);
    expect(countNonZeroBytes(buf)).toBe(0);
  });

  it('範囲外座標は何もしない（隣の行のピクセルを消さない）', () => {
    const buf = new PixelBuffer();
    fillAll(buf, [1, 2, 3, 255]);

    expect(() => {
      buf.erasePixel(64, 0);
      buf.erasePixel(-1, 1);
      buf.erasePixel(0, -1);
      buf.erasePixel(0, 64);
    }).not.toThrow();

    expect(paintedCoords(buf)).toHaveLength(PIXEL_COUNT);
    expect(buf.getPixel(0, 1)).toEqual([1, 2, 3, 255]);
    expect(buf.getPixel(63, 0)).toEqual([1, 2, 3, 255]);
  });
});

// ---- setPixel32 / rgbaTo32 ----

describe('rgbaTo32', () => {
  it('R が最下位バイト、A が最上位バイトの 32bit 値（ABGR）を返す', () => {
    expect(PixelBuffer.rgbaTo32(0x11, 0x22, 0x33, 0x44) >>> 0).toBe(0x44332211);
    expect(PixelBuffer.rgbaTo32(0, 0, 0, 0) >>> 0).toBe(0);
  });

  it('アルファ 128 以上（符号ビットが立つ）でも正しいビット列になる', () => {
    expect(PixelBuffer.rgbaTo32(1, 2, 3, 255) >>> 0).toBe(0xff030201);
    expect(PixelBuffer.rgbaTo32(255, 255, 255, 255) >>> 0).toBe(0xffffffff);
  });
});

describe('setPixel32', () => {
  it.runIf(isLittleEndian)('rgbaTo32 の値で設定すると getPixel で同じ RGBA が得られる', () => {
    const buf = new PixelBuffer();
    const cases: Array<[number, number, Pixel]> = [
      [0, 0, [255, 0, 0, 255]],
      [1, 0, [0, 255, 0, 128]],
      [0, 1, [12, 34, 56, 78]],
      [63, 63, [255, 255, 255, 255]],
    ];
    for (const [x, y, [r, g, b, a]] of cases) {
      buf.setPixel32(x, y, PixelBuffer.rgbaTo32(r, g, b, a));
    }
    for (const [x, y, color] of cases) {
      expect(buf.getPixel(x, y)).toEqual(color);
    }
  });

  it.runIf(isLittleEndian)('setPixel と同じバイト配置になる', () => {
    const a = new PixelBuffer();
    const b = new PixelBuffer();
    a.setPixel(7, 9, 10, 20, 30, 200);
    b.setPixel32(7, 9, PixelBuffer.rgbaTo32(10, 20, 30, 200));
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });

  it('範囲外座標は何もしない（隣の行に回り込まない）', () => {
    const buf = new PixelBuffer();
    const white = PixelBuffer.rgbaTo32(255, 255, 255, 255);
    buf.setPixel32(64, 0, white);
    buf.setPixel32(-1, 1, white);
    buf.setPixel32(0, -1, white);
    buf.setPixel32(0, 64, white);
    expect(countNonZeroBytes(buf)).toBe(0);
  });
});

// ---- setPixelRect / erasePixelRect ----

describe('setPixelRect', () => {
  it('両端を含む矩形領域を塗る', () => {
    const buf = new PixelBuffer();
    buf.setPixelRect(2, 3, 5, 4, 10, 20, 30, 255);

    expect(paintedCoords(buf)).toEqual(rectCoords(2, 3, 5, 4));
    expect(buf.getPixel(2, 3)).toEqual([10, 20, 30, 255]);
    expect(buf.getPixel(5, 4)).toEqual([10, 20, 30, 255]);
  });

  it('始点と終点が逆でも同じ矩形を塗る', () => {
    const a = new PixelBuffer();
    const b = new PixelBuffer();
    const c = new PixelBuffer();
    a.setPixelRect(2, 3, 5, 4, 1, 2, 3, 255);
    b.setPixelRect(5, 4, 2, 3, 1, 2, 3, 255);
    c.setPixelRect(5, 3, 2, 4, 1, 2, 3, 255);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    expect(Array.from(c.data)).toEqual(Array.from(a.data));
  });

  it('始点と終点が同じなら 1 ピクセルだけ塗る', () => {
    const buf = new PixelBuffer();
    buf.setPixelRect(8, 8, 8, 8, 1, 2, 3, 4);
    expect(paintedCoords(buf)).toEqual(['8,8']);
    expect(buf.getPixel(8, 8)).toEqual([1, 2, 3, 4]);
  });

  it('既存の色はブレンドせずに置き換える', () => {
    const buf = new PixelBuffer();
    fillAll(buf, [255, 255, 255, 255]);
    buf.setPixelRect(0, 0, 1, 1, 10, 20, 30, 40);
    expect(buf.getPixel(0, 0)).toEqual([10, 20, 30, 40]);
    expect(buf.getPixel(1, 1)).toEqual([10, 20, 30, 40]);
    expect(buf.getPixel(2, 2)).toEqual([255, 255, 255, 255]);
  });

  it('一部がはみ出す矩形はキャンバス内にクリップされる', () => {
    const buf = new PixelBuffer();
    buf.setPixelRect(-5, -3, 1, 2, 1, 1, 1, 255);
    expect(paintedCoords(buf)).toEqual(rectCoords(0, 0, 1, 2));
  });

  it('右端をはみ出しても次の行に回り込まない', () => {
    const buf = new PixelBuffer();
    buf.setPixelRect(62, 0, 70, 0, 1, 1, 1, 255);
    expect(paintedCoords(buf)).toEqual(['62,0', '63,0']);
  });

  it('下端をはみ出してもバッファ外に書き込まない', () => {
    const buf = new PixelBuffer();
    buf.setPixelRect(0, 62, 0, 100, 1, 1, 1, 255);
    expect(paintedCoords(buf)).toEqual(['0,62', '0,63']);
    expect(buf.data.length).toBe(BUFFER_SIZE);
  });

  it('キャンバス全体を覆う矩形は全ピクセルを塗る', () => {
    const buf = new PixelBuffer();
    buf.setPixelRect(-100, -100, 100, 100, 5, 6, 7, 8);
    expect(paintedCoords(buf)).toHaveLength(PIXEL_COUNT);
    for (let i = 0; i < buf.data.length; i += 4) {
      expect(Array.from(buf.data.subarray(i, i + 4))).toEqual([5, 6, 7, 8]);
    }
  });

  it.each([
    ['完全に左', -10, 0, -1, 5],
    ['完全に右', 64, 0, 80, 5],
    ['完全に上', 0, -10, 5, -1],
    ['完全に下', 0, 64, 5, 80],
  ])('キャンバス外（%s）の矩形は何もしない', (_label, x1, y1, x2, y2) => {
    const buf = new PixelBuffer();
    expect(() => buf.setPixelRect(x1, y1, x2, y2, 255, 255, 255, 255)).not.toThrow();
    expect(countNonZeroBytes(buf)).toBe(0);
  });

  it('非正方形バッファでは width / height でクリップされる', () => {
    const buf = new PixelBuffer(3, 2);
    buf.setPixelRect(0, 0, 10, 10, 1, 1, 1, 1);
    expect(paintedCoords(buf)).toEqual(rectCoords(0, 0, 2, 1));
    expect(buf.data.length).toBe(24);
  });
});

describe('erasePixelRect', () => {
  it('矩形内だけを (0, 0, 0, 0) にする', () => {
    const buf = new PixelBuffer();
    fillAll(buf, [50, 60, 70, 255]);

    buf.erasePixelRect(10, 10, 12, 11);

    for (const coord of rectCoords(10, 10, 12, 11)) {
      const [x, y] = coord.split(',').map(Number);
      expect(buf.getPixel(x, y)).toEqual([0, 0, 0, 0]);
    }
    expect(paintedCoords(buf)).toHaveLength(PIXEL_COUNT - 3 * 2);
    expect(buf.getPixel(9, 10)).toEqual([50, 60, 70, 255]);
    expect(buf.getPixel(13, 11)).toEqual([50, 60, 70, 255]);
    expect(buf.getPixel(10, 12)).toEqual([50, 60, 70, 255]);
  });

  it('始点と終点が逆でもよく、はみ出した部分はクリップされる', () => {
    const buf = new PixelBuffer();
    fillAll(buf, [1, 1, 1, 255]);

    buf.erasePixelRect(70, 1, 62, 0);

    expect(buf.getPixel(62, 0)).toEqual([0, 0, 0, 0]);
    expect(buf.getPixel(63, 1)).toEqual([0, 0, 0, 0]);
    // 次の行の先頭（回り込み先）は消えない
    expect(buf.getPixel(0, 1)).toEqual([1, 1, 1, 255]);
    expect(buf.getPixel(0, 2)).toEqual([1, 1, 1, 255]);
    expect(paintedCoords(buf)).toHaveLength(PIXEL_COUNT - 2 * 2);
  });
});

// ---- clear ----

describe('clear', () => {
  it('全ピクセルを (0, 0, 0, 0) にする', () => {
    const buf = new PixelBuffer();
    fillPattern(buf);
    expect(countNonZeroBytes(buf)).toBeGreaterThan(0);

    buf.clear();

    expect(countNonZeroBytes(buf)).toBe(0);
    expect(buf.data.length).toBe(BUFFER_SIZE);
  });

  it('レイヤー順序（order）とサイズは維持する', () => {
    const buf = new PixelBuffer(3, 2);
    buf.order = 7;
    buf.setPixel(0, 0, 1, 2, 3, 4);

    buf.clear();

    expect(buf.order).toBe(7);
    expect(buf.width).toBe(3);
    expect(buf.height).toBe(2);
  });

  it('クリア後も通常どおり描画できる', () => {
    const buf = new PixelBuffer();
    buf.setPixel(1, 1, 9, 9, 9, 9);
    buf.clear();
    buf.setPixel(2, 2, 1, 2, 3, 4);
    expect(paintedCoords(buf)).toEqual(['2,2']);
  });
});

// ---- clone ----

describe('clone', () => {
  it('同じサイズ・ピクセル・order を持つ新しいバッファを返す', () => {
    const buf = new PixelBuffer();
    fillPattern(buf);
    buf.order = 3;

    const cloned = buf.clone();

    expect(cloned).toBeInstanceOf(PixelBuffer);
    expect(cloned).not.toBe(buf);
    expect(cloned.width).toBe(buf.width);
    expect(cloned.height).toBe(buf.height);
    expect(cloned.order).toBe(3);
    expect(Array.from(cloned.data)).toEqual(Array.from(buf.data));
  });

  it('複製と元のバッファは独立している', () => {
    const buf = new PixelBuffer();
    buf.setPixel(0, 0, 10, 10, 10, 255);
    const cloned = buf.clone();

    expect(cloned.data.buffer).not.toBe(buf.data.buffer);

    cloned.setPixel(0, 0, 99, 99, 99, 99);
    cloned.setPixel(1, 0, 1, 1, 1, 1);
    expect(buf.getPixel(0, 0)).toEqual([10, 10, 10, 255]);
    expect(buf.getPixel(1, 0)).toEqual([0, 0, 0, 0]);

    buf.erasePixel(0, 0);
    expect(cloned.getPixel(0, 0)).toEqual([99, 99, 99, 99]);

    cloned.order = 42;
    expect(buf.order).toBe(0);
  });

  it('複製の data32 も複製側のデータを指す', () => {
    const buf = new PixelBuffer();
    const cloned = buf.clone();
    expect(cloned.data32.buffer).toBe(cloned.data.buffer);
    cloned.setPixel(0, 0, 1, 2, 3, 4);
    expect(cloned.data32[0]).not.toBe(0);
    expect(buf.data32[0]).toBe(0);
  });

  it('非正方形バッファも複製できる', () => {
    const buf = new PixelBuffer(3, 2);
    buf.setPixel(2, 1, 5, 6, 7, 8);
    const cloned = buf.clone();
    expect(cloned.width).toBe(3);
    expect(cloned.height).toBe(2);
    expect(cloned.getPixel(2, 1)).toEqual([5, 6, 7, 8]);
  });
});

// ---- copyFrom ----

describe('copyFrom', () => {
  it('同じサイズのバッファからピクセルデータをコピーする（既存内容は上書き）', () => {
    const source = new PixelBuffer();
    fillPattern(source);
    const dest = new PixelBuffer();
    fillAll(dest, [255, 255, 255, 255]);
    source.erasePixel(0, 0);

    dest.copyFrom(source);

    expect(Array.from(dest.data)).toEqual(Array.from(source.data));
    expect(dest.getPixel(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('コピー後は元バッファと独立している', () => {
    const source = new PixelBuffer();
    source.setPixel(0, 0, 1, 2, 3, 4);
    const dest = new PixelBuffer();

    dest.copyFrom(source);
    source.setPixel(0, 0, 9, 9, 9, 9);
    dest.setPixel(1, 0, 5, 5, 5, 5);

    expect(dest.getPixel(0, 0)).toEqual([1, 2, 3, 4]);
    expect(source.getPixel(1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('コピー先の order は変更しない', () => {
    const source = new PixelBuffer();
    source.order = 5;
    const dest = new PixelBuffer();
    dest.order = 2;

    dest.copyFrom(source);

    expect(dest.order).toBe(2);
  });

  it.each([
    ['幅が異なる', 32, 64],
    ['高さが異なる', 64, 32],
    ['ピクセル数は同じだが形が異なる', 128, 32],
  ])('%s場合はエラーを投げ、内容を変更しない', (_label, w, h) => {
    const source = new PixelBuffer(w, h);
    fillAll(source, [1, 1, 1, 1]);
    const dest = new PixelBuffer();
    dest.setPixel(0, 0, 7, 7, 7, 7);

    expect(() => dest.copyFrom(source)).toThrow('Buffer size mismatch');
    expect(dest.getPixel(0, 0)).toEqual([7, 7, 7, 7]);
    expect(countNonZeroBytes(dest)).toBe(4);
  });
});

// ---- setFromArrayBuffer ----

describe('setFromArrayBuffer', () => {
  it('同じ長さの ArrayBuffer から全ピクセルを置き換える', () => {
    const source = new PixelBuffer();
    fillPattern(source);
    const dest = new PixelBuffer();
    fillAll(dest, [255, 255, 255, 255]);
    source.erasePixel(3, 3);

    dest.setFromArrayBuffer(source.getTransferableBuffer());

    expect(Array.from(dest.data)).toEqual(Array.from(source.data));
    expect(dest.getPixel(3, 3)).toEqual([0, 0, 0, 0]);
  });

  it('渡した ArrayBuffer とはメモリを共有しない', () => {
    const raw = new Uint8ClampedArray(BUFFER_SIZE);
    raw.set([1, 2, 3, 4], 0);
    const dest = new PixelBuffer();

    dest.setFromArrayBuffer(raw.buffer);
    raw.set([9, 9, 9, 9], 0);

    expect(dest.getPixel(0, 0)).toEqual([1, 2, 3, 4]);
  });

  it('既存の data / data32 オブジェクトを差し替えずに中身だけ更新する', () => {
    const dest = new PixelBuffer();
    const { data, data32 } = dest;
    const raw = new Uint8ClampedArray(BUFFER_SIZE).fill(7);

    dest.setFromArrayBuffer(raw.buffer);

    expect(dest.data).toBe(data);
    expect(dest.data32).toBe(data32);
    expect(dest.getPixel(10, 10)).toEqual([7, 7, 7, 7]);
  });

  it.each([
    ['短い', BUFFER_SIZE - 4],
    ['長い', BUFFER_SIZE + 4],
    ['空', 0],
  ])('長さが異なる（%s）場合はエラーを投げ、内容を変更しない', (_label, length) => {
    const dest = new PixelBuffer();
    dest.setPixel(0, 0, 7, 7, 7, 7);

    expect(() => dest.setFromArrayBuffer(new ArrayBuffer(length))).toThrow('Buffer size mismatch');
    expect(dest.getPixel(0, 0)).toEqual([7, 7, 7, 7]);
  });
});

// ---- getTransferableBuffer ----

describe('getTransferableBuffer', () => {
  it('現在のピクセルデータと同じ内容の ArrayBuffer を返す', () => {
    const buf = new PixelBuffer();
    fillPattern(buf);

    const ab = buf.getTransferableBuffer();

    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(ab.byteLength).toBe(BUFFER_SIZE);
    expect(Array.from(new Uint8ClampedArray(ab))).toEqual(Array.from(buf.data));
  });

  it('コピーを返すため、転送（detach）しても元のバッファは使い続けられる', () => {
    const buf = new PixelBuffer();
    buf.setPixel(1, 2, 3, 4, 5, 6);

    const ab = buf.getTransferableBuffer();
    expect(ab).not.toBe(buf.data.buffer);
    structuredClone(ab, { transfer: [ab] });
    expect(ab.byteLength).toBe(0);

    expect(buf.data.length).toBe(BUFFER_SIZE);
    expect(buf.getPixel(1, 2)).toEqual([3, 4, 5, 6]);
    buf.setPixel(0, 0, 1, 1, 1, 1);
    expect(buf.getPixel(0, 0)).toEqual([1, 1, 1, 1]);
  });

  it('取得後の変更は互いに影響しない', () => {
    const buf = new PixelBuffer();
    buf.setPixel(0, 0, 1, 2, 3, 4);
    const ab = buf.getTransferableBuffer();
    const view = new Uint8ClampedArray(ab);

    buf.setPixel(0, 0, 9, 9, 9, 9);
    expect(Array.from(view.subarray(0, 4))).toEqual([1, 2, 3, 4]);

    view[4] = 200;
    expect(buf.getPixel(1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('新しい PixelBuffer に渡すと同じ内容を復元できる（ラウンドトリップ）', () => {
    const buf = new PixelBuffer();
    fillPattern(buf);
    const restored = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT, buf.getTransferableBuffer());
    expect(Array.from(restored.data)).toEqual(Array.from(buf.data));
  });
});

// ---- toImageData ----

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

  it('同じサイズ・内容の ImageData を返す', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const buf = new PixelBuffer(3, 2);
    buf.setPixel(1, 1, 10, 20, 30, 40);

    const img = buf.toImageData();

    expect(img).toBeInstanceOf(FakeImageData);
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(Array.from(img.data)).toEqual(Array.from(buf.data));
  });

  it('ImageData のデータはコピーで、バッファと独立している', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const buf = new PixelBuffer();
    buf.setPixel(0, 0, 1, 2, 3, 4);

    const img = buf.toImageData();
    expect(img.data).not.toBe(buf.data);
    expect(img.data.buffer).not.toBe(buf.data.buffer);

    buf.setPixel(0, 0, 9, 9, 9, 9);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([1, 2, 3, 4]);

    img.data[4] = 255;
    expect(buf.getPixel(1, 0)).toEqual([0, 0, 0, 0]);
  });
});
