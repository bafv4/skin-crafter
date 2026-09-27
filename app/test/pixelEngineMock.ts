// テスト用の PixelEngine モック（Web Worker を起動しない）
//
// 使い方（ストアをテストするファイルの先頭で）:
//   vi.mock('../lib/pixelEngine', () => import('../test/pixelEngineMock'));
//   import { engine } from '../test/pixelEngineMock';
//   // engine.setPixel などは vi.fn() なので呼び出しを検証できる
import { vi } from 'vitest';

export const SKIN_WIDTH = 64;
export const SKIN_HEIGHT = 64;

export const engine = {
  init: vi.fn(),
  createLayer: vi.fn(),
  deleteLayer: vi.fn(),
  clearAllLayers: vi.fn(),
  setPixel: vi.fn(),
  erasePixel: vi.fn(),
  setPixelRect: vi.fn(),
  erasePixelRect: vi.fn(),
  clearLayer: vi.fn(),
  setLayerOrder: vi.fn(),
  requestComposite: vi.fn(),
  getLayerData: vi.fn(),
  getAllLayersData: vi.fn(),
  setLayerData: vi.fn(),
  duplicateLayer: vi.fn(),
  getPixel: vi.fn(),
  destroy: vi.fn(),
};

export function getPixelEngine() {
  return engine;
}

export function destroyPixelEngine() {}
