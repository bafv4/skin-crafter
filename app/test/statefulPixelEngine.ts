// テスト用の「状態を持つ」PixelEngine（Web Worker と同じ処理を PixelBuffer で行う）
//
// 使い方（ストアをテストするファイルの先頭で）:
//   vi.mock('../lib/pixelEngine', () => import('../test/statefulPixelEngine'));
//   import { engineLayers } from '../test/statefulPixelEngine';
// engineLayers にはエンジン側（Worker 側）が持つレイヤーのピクセルと重なり順が入る
import { vi } from 'vitest';
import { PixelBuffer } from '../lib/pixelEngine/PixelBuffer';

export const SKIN_WIDTH = 64;
export const SKIN_HEIGHT = 64;

export const engineLayers = new Map<string, PixelBuffer>();

function toBuffer(data: Uint8ClampedArray | ArrayBuffer): ArrayBuffer {
  return data instanceof ArrayBuffer ? data : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

// worker.ts の各コマンドと同じ処理
export const engine = {
  init: vi.fn(),
  createLayer: vi.fn((layerId: string, order: number) => {
    const buffer = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT);
    buffer.order = order;
    engineLayers.set(layerId, buffer);
  }),
  deleteLayer: vi.fn((layerId: string) => {
    engineLayers.delete(layerId);
  }),
  clearAllLayers: vi.fn(() => {
    engineLayers.clear();
  }),
  setPixel: vi.fn((layerId: string, x: number, y: number, r: number, g: number, b: number, a: number) => {
    engineLayers.get(layerId)?.setPixel(x, y, r, g, b, a);
  }),
  erasePixel: vi.fn((layerId: string, x: number, y: number) => {
    engineLayers.get(layerId)?.erasePixel(x, y);
  }),
  setPixelRect: vi.fn(
    (layerId: string, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a: number) => {
      engineLayers.get(layerId)?.setPixelRect(x1, y1, x2, y2, r, g, b, a);
    }
  ),
  erasePixelRect: vi.fn((layerId: string, x1: number, y1: number, x2: number, y2: number) => {
    engineLayers.get(layerId)?.erasePixelRect(x1, y1, x2, y2);
  }),
  clearLayer: vi.fn((layerId: string) => {
    engineLayers.get(layerId)?.clear();
  }),
  setLayerOrder: vi.fn((layerId: string, order: number) => {
    const layer = engineLayers.get(layerId);
    if (layer) layer.order = order;
  }),
  setLayerData: vi.fn((layerId: string, order: number, data: Uint8ClampedArray | ArrayBuffer) => {
    let layer = engineLayers.get(layerId);
    if (!layer) {
      layer = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT);
      engineLayers.set(layerId, layer);
    }
    layer.setFromArrayBuffer(toBuffer(data));
    layer.order = order;
  }),
  duplicateLayer: vi.fn((sourceId: string, newId: string, newOrder: number) => {
    const source = engineLayers.get(sourceId);
    if (source) {
      const cloned = source.clone();
      cloned.order = newOrder;
      engineLayers.set(newId, cloned);
    }
  }),
  requestComposite: vi.fn(),
  getLayerData: vi.fn(),
  getAllLayersData: vi.fn(),
  getPixel: vi.fn(),
  destroy: vi.fn(),
};

export function getPixelEngine() {
  return engine;
}

export function destroyPixelEngine() {}
