// ストアと PixelEngine（Web Worker 側）のレイヤーが一致し続けることのテスト
// （CLAUDE.md: レイヤーのピクセルはストアと Worker の両方にあり、常に同じ内容を保つ）
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pixelEngine', () => import('../test/statefulPixelEngine'));

import { engineLayers } from '../test/statefulPixelEngine';
import { useEditorStore } from './editorStore';
import { SKIN_HEIGHT, SKIN_WIDTH, type RGBA } from '../types/editor';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const s = () => useEditorStore.getState();

class TestImageData {
  readonly data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
const globals = globalThis as unknown as { ImageData?: unknown };
let originalImageData: unknown;

// ストアのレイヤーとエンジン側のレイヤーが、ID・重なり順・ピクセルまで一致すること
function expectEngineInSync() {
  const storeIds = s().layers.map((l) => l.id).sort();
  expect([...engineLayers.keys()].sort()).toEqual(storeIds);
  for (const layer of s().layers) {
    const buffer = engineLayers.get(layer.id)!;
    expect(buffer.order, `order: ${layer.name}`).toBe(layer.order);
    const expected = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const p = layer.pixels[y][x];
        if (p) expected.set([p.r, p.g, p.b, p.a], (y * SKIN_WIDTH + x) * 4);
      }
    }
    expect(Buffer.from(buffer.data).equals(Buffer.from(expected)), `pixels: ${layer.name}`).toBe(true);
  }
}

beforeAll(async () => {
  originalImageData = globals.ImageData;
  if (typeof globals.ImageData === 'undefined') globals.ImageData = TestImageData;
  if (!useEditorStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useEditorStore.persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
    });
  }
});

afterAll(() => {
  globals.ImageData = originalImageData;
});

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  s().saveToHistory();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  engineLayers.clear();
});

// 2 レイヤー（片方はグループ内）に描いた状態
function setup() {
  const a = s().createLayer('A', RED, 'direct');
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) s().setPixel(x, y, RED);
  s().setPixel(9, 9, GREEN);
  s().commitDrawing();
  const b = s().createLayer('B', BLUE, 'singleColor');
  s().setPixelRect(12, 8, 13, 9, BLUE);
  const group = s().createLayerGroup('G');
  s().moveLayerToGroup(b, group);
  return { a, b, group };
}

describe('ストアと PixelEngine のレイヤーの一致', () => {
  it('レイヤーがないときに描くと自動作成されたレイヤーもエンジンに登録される', () => {
    s().setPixel(3, 3, RED);
    s().commitDrawing();
    expectEngineInSync();
    s().setPixelRect(5, 5, 6, 6, BLUE);
    expectEngineInSync();
  });

  it('矩形塗り（上書き禁止モードでは既存のピクセルを残す）', () => {
    const { a } = setup();
    s().setActiveLayer(a);
    s().togglePreservePixels();
    s().setPixelRect(6, 6, 13, 13, BLUE);
    expectEngineInSync();
    s().togglePreservePixels();
    s().setPixelRect(0, 0, 3, 3, null);
    expectEngineInSync();
  });

  it('重なり順の変更・グループへの移動', () => {
    const { a, b, group } = setup();
    s().reorderLayer(a, 7, null);
    expectEngineInSync();
    s().moveLayerToGroup(a, group);
    expectEngineInSync();
    s().moveLayerToGroup(b, null);
    expectEngineInSync();
  });

  const ACTIONS: Array<[string, (ids: { a: string; b: string }) => void]> = [
    ['updateLayerColor', ({ b }) => s().updateLayerColor(b, GREEN)],
    ['applyNoise', ({ b }) => s().applyNoise(b, 30, 10)],
    ['resetNoise', ({ b }) => { s().applyNoise(b, 30, 10); s().resetNoise(b); }],
    ['deleteLayer', ({ a }) => s().deleteLayer(a)],
    ['duplicateLayer', ({ a }) => { s().duplicateLayer(a); }],
    ['mergeLayersById', ({ a, b }) => s().mergeLayersById(b, a)],
    ['mergeLayersById（同じレイヤー）', ({ a }) => s().mergeLayersById(a, a)],
    ['mergeSimilarLayersAction', () => s().mergeSimilarLayersAction({ thresholdValue: 441, applyNoise: false })],
    ['splitLayerByColorAction', ({ a }) => s().splitLayerByColorAction(a, { applyNoise: false })],
    ['splitLayerBySelectionAction', ({ a }) => { s().splitLayerBySelectionAction(a, [{ x: 8, y: 8 }]); }],
    ['blendBordersAction', () => s().blendBordersAction(50)],
    ['generateLayers', () => s().generateLayers({ applyNoise: false })],
    ['loadFromImageData', () => {
      const image = new TestImageData(SKIN_WIDTH, SKIN_HEIGHT);
      image.data.set([10, 20, 30, 255], 0);
      s().loadFromImageData(image as unknown as ImageData);
    }],
  ];

  it.each(ACTIONS)('%s の後、元に戻す・やり直しの後も一致する', (_name, action) => {
    const ids = setup();
    expectEngineInSync();
    action(ids);
    expectEngineInSync();
    s().undo();
    expectEngineInSync();
    s().redo();
    expectEngineInSync();
  });
});
