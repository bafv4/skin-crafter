/**
 * PixelBuffer - レイヤーのピクセルデータを管理するクラス
 * Uint8ClampedArray をバッキングストアとして使用し、高速なピクセル操作を提供
 */

export const SKIN_WIDTH = 64;
export const SKIN_HEIGHT = 64;
export const PIXEL_COUNT = SKIN_WIDTH * SKIN_HEIGHT;
export const BUFFER_SIZE = PIXEL_COUNT * 4; // RGBA

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly data32: Uint32Array;

  order: number = 0;

  constructor(width: number = SKIN_WIDTH, height: number = SKIN_HEIGHT, existingBuffer?: ArrayBuffer) {
    this.width = width;
    this.height = height;

    if (existingBuffer) {
      // 既存のバッファからコピー（Transferable後のバッファは使用不可になるため）
      this.data = new Uint8ClampedArray(existingBuffer.byteLength);
      this.data.set(new Uint8ClampedArray(existingBuffer));
    } else {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
    // 32bit ビューを作成（高速なピクセル操作用）
    this.data32 = new Uint32Array(this.data.buffer);
  }

  /**
   * 指定座標にピクセルを設定
   */
  setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }

  /**
   * 指定座標のピクセルを消去（透明に）
   */
  erasePixel(x: number, y: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = 0;
    this.data[i + 1] = 0;
    this.data[i + 2] = 0;
    this.data[i + 3] = 0;
  }

  /**
   * 高速版ピクセル設定（Uint32Array使用）
   * color32 は ABGR 形式（little-endian システム）
   */
  setPixel32(x: number, y: number, color32: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.data32[y * this.width + x] = color32;
  }

  /**
   * RGBA を 32bit 値に変換（little-endian: ABGR）
   */
  static rgbaTo32(r: number, g: number, b: number, a: number): number {
    return (a << 24) | (b << 16) | (g << 8) | r;
  }

  /**
   * 指定座標のピクセルを取得
   */
  getPixel(x: number, y: number): [number, number, number, number] {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return [0, 0, 0, 0];
    }
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /**
   * 矩形領域にピクセルを設定
   */
  setPixelRect(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a: number): void {
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(this.width - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(this.height - 1, Math.max(y1, y2));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * this.width + x) * 4;
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
        this.data[i + 3] = a;
      }
    }
  }

  /**
   * 矩形領域を消去
   */
  erasePixelRect(x1: number, y1: number, x2: number, y2: number): void {
    this.setPixelRect(x1, y1, x2, y2, 0, 0, 0, 0);
  }

  /**
   * バッファ全体をクリア
   */
  clear(): void {
    this.data.fill(0);
  }

  /**
   * バッファを複製
   */
  clone(): PixelBuffer {
    const cloned = new PixelBuffer(this.width, this.height);
    cloned.data.set(this.data);
    cloned.order = this.order;
    return cloned;
  }

  /**
   * 別のバッファからデータをコピー
   */
  copyFrom(source: PixelBuffer): void {
    if (source.width !== this.width || source.height !== this.height) {
      throw new Error('Buffer size mismatch');
    }
    this.data.set(source.data);
  }

  /**
   * ArrayBuffer からデータを設定
   */
  setFromArrayBuffer(buffer: ArrayBuffer): void {
    const source = new Uint8ClampedArray(buffer);
    if (source.length !== this.data.length) {
      throw new Error('Buffer size mismatch');
    }
    this.data.set(source);
  }

  /**
   * Transferable 用にバッファのコピーを取得
   * 注意: 元のバッファはそのまま使用可能
   */
  getTransferableBuffer(): ArrayBuffer {
    return this.data.buffer.slice(0) as ArrayBuffer;
  }

  /**
   * ImageData を生成（Canvas描画用）
   */
  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.data), this.width, this.height);
  }
}
