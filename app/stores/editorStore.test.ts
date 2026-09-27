// エディタストア（履歴以外のアクション）のテスト
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Web Worker を起動しないよう PixelEngine をモックに差し替える
vi.mock('../lib/pixelEngine', () => import('../test/pixelEngineMock'));

import { useEditorStore } from './editorStore';
import { engine } from '../test/pixelEngineMock';
import {
  type Layer,
  type RGBA,
  DEFAULT_CANVAS_BACKGROUND,
  SKIN_HEIGHT,
  SKIN_WIDTH,
} from '../types/editor';

// ---- テスト用ヘルパー ----

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

const store = () => useEditorStore.getState();

function layerOf(id: string): Layer {
  const layer = store().layers.find((l) => l.id === id);
  if (!layer) throw new Error(`レイヤーが見つかりません: ${id}`);
  return layer;
}

function pixelOf(id: string, x: number, y: number): RGBA | null {
  return layerOf(id).pixels[y][x];
}

// 色が塗られている（null でない）ピクセルの座標一覧
function paintedCoords(id: string): string[] {
  const coords: string[] = [];
  const { pixels } = layerOf(id);
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      if (pixels[y][x]) coords.push(`${x},${y}`);
    }
  }
  return coords;
}

// 合成結果の 1 ピクセル
function compositeAt(x: number, y: number): RGBA {
  return store().getComposite()[y][x];
}

// 永続化の初回読み込み（非同期）が完了してからテストを始める。
// テストの途中で読み込みが完了するとストアの状態が置き換えられてしまうため
beforeAll(async () => {
  if (!useEditorStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsubscribe = useEditorStore.persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
    });
  }
});

beforeEach(() => {
  // 前のテストで描画途中（commit 前）のまま終わった場合のスナップショットを確定・破棄する
  store().saveToHistory();
  // ストアを初期状態に戻す
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  vi.clearAllMocks();

  // ID 生成（Math.random）を決定的かつ重複しないようにする
  let n = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => (++n * 0.6180339887) % 1);
});

// ================================================================
// 初期状態
// ================================================================

describe('初期状態', () => {
  it('レイヤー・グループ・パレットが空で、鉛筆ツールが選択されている', () => {
    const s = store();
    expect(s.layers).toEqual([]);
    expect(s.layerGroups).toEqual([]);
    expect(s.palette).toEqual([]);
    expect(s.activeLayerId).toBeNull();
    expect(s.activeTool).toBe('pencil');
    expect(s.previousTool).toBe('pencil');
    expect(s.layerColorPickTarget).toBeNull();
    expect(s.drawingColor).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(s.canvasBackground).toEqual(DEFAULT_CANVAS_BACKGROUND);
    expect(s.preservePixels).toBe(false);
    expect(s.history).toEqual([]);
    expect(s.historyIndex).toBe(-1);
  });
});

// ================================================================
// createLayer
// ================================================================

describe('createLayer', () => {
  it('既定では singleColor レイヤーを作成し、アクティブにして ID を返す', () => {
    const id = store().createLayer('肌', RED);

    const s = store();
    expect(s.layers).toHaveLength(1);
    expect(s.activeLayerId).toBe(id);

    const layer = layerOf(id);
    expect(layer).toMatchObject({
      id,
      name: '肌',
      baseColor: RED,
      layerType: 'singleColor',
      groupId: null,
      order: 0,
      visible: true,
      opacity: 100,
      noiseSettings: { brightness: 0, hue: 0 },
    });
  });

  it('layerType に direct を指定できる', () => {
    const id = store().createLayer('自由描画', BLUE, 'direct');
    expect(layerOf(id).layerType).toBe('direct');
  });

  it('ピクセルは 64x64 の全面透明（null）で作成される', () => {
    const id = store().createLayer('空', RED);
    const { pixels } = layerOf(id);
    expect(pixels).toHaveLength(SKIN_HEIGHT);
    for (const row of pixels) {
      expect(row).toHaveLength(SKIN_WIDTH);
      expect(row.every((p) => p === null)).toBe(true);
    }
  });

  it('order は既存レイヤーの最大値 + 1 になる（連番でなくても）', () => {
    const a = store().createLayer('A', RED);
    const b = store().createLayer('B', GREEN);
    expect(layerOf(a).order).toBe(0);
    expect(layerOf(b).order).toBe(1);

    store().reorderLayer(a, 10, null);
    const c = store().createLayer('C', BLUE);
    expect(layerOf(c).order).toBe(11);
  });

  it('作成するたびに異なる ID を返し、最後に作成したレイヤーがアクティブになる', () => {
    const ids = [
      store().createLayer('1', RED),
      store().createLayer('2', RED),
      store().createLayer('3', RED),
    ];
    expect(new Set(ids).size).toBe(3);
    expect(store().activeLayerId).toBe(ids[2]);
  });

  it('PixelEngine にも同じ ID・order でレイヤーを作成する', () => {
    store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    expect(engine.createLayer).toHaveBeenCalledTimes(2);
    expect(engine.createLayer).toHaveBeenLastCalledWith(b, 1);
  });

  it('履歴には記録しない', () => {
    store().createLayer('A', RED);
    expect(store().history).toHaveLength(0);
  });
});

// ================================================================
// setPixel
// ================================================================

describe('setPixel', () => {
  it('direct レイヤーでは指定した色で塗る', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(3, 4, BLUE);
    expect(pixelOf(id, 3, 4)).toEqual(BLUE);
    expect(paintedCoords(id)).toEqual(['3,4']);
  });

  it('singleColor レイヤーでは指定した色に関係なく基本色で塗る', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixel(3, 4, BLUE);
    expect(pixelOf(id, 3, 4)).toEqual(RED);
  });

  it('null を渡すとピクセルを消去する', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(1, 1, GREEN);
    store().setPixel(1, 1, null);
    expect(pixelOf(id, 1, 1)).toBeNull();
    expect(paintedCoords(id)).toEqual([]);
  });

  it('アクティブレイヤーだけを変更する', () => {
    const a = store().createLayer('A', RED, 'direct');
    const b = store().createLayer('B', BLUE, 'direct');
    store().setActiveLayer(a);
    store().setPixel(0, 0, GREEN);
    expect(pixelOf(a, 0, 0)).toEqual(GREEN);
    expect(pixelOf(b, 0, 0)).toBeNull();
  });

  it('渡した色オブジェクトを後から変更しても保存済みピクセルは変わらない', () => {
    const id = store().createLayer('D', RED, 'direct');
    const color = { ...GREEN };
    store().setPixel(0, 0, color);
    color.r = 99;
    expect(pixelOf(id, 0, 0)).toEqual(GREEN);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [SKIN_WIDTH, 0],
    [0, SKIN_HEIGHT],
    [100, 100],
  ])('範囲外の座標 (%i, %i) は無視する（レイヤーも自動作成しない）', (x, y) => {
    store().setPixel(x, y, RED);
    expect(store().layers).toHaveLength(0);
    expect(store().activeLayerId).toBeNull();
    expect(engine.setPixel).not.toHaveBeenCalled();
  });

  it('範囲内の端（0,0 と 63,63）は塗れる', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(0, 0, GREEN);
    store().setPixel(SKIN_WIDTH - 1, SKIN_HEIGHT - 1, GREEN);
    expect(paintedCoords(id)).toEqual(['0,0', '63,63']);
  });

  it('色を塗ると PixelEngine.setPixel を呼ぶ', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(5, 6, { r: 10, g: 20, b: 30, a: 40 });
    expect(engine.setPixel).toHaveBeenCalledWith(id, 5, 6, 10, 20, 30, 40);
    expect(engine.erasePixel).not.toHaveBeenCalled();
  });

  it('singleColor レイヤーでは PixelEngine にも基本色を送る', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixel(5, 6, BLUE);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 5, 6, 255, 0, 0, 255);
  });

  it('消去すると PixelEngine.erasePixel を呼ぶ', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(5, 6, GREEN);
    vi.clearAllMocks();
    store().setPixel(5, 6, null);
    expect(engine.erasePixel).toHaveBeenCalledWith(id, 5, 6);
    expect(engine.setPixel).not.toHaveBeenCalled();
  });

  it('同じ色で塗り直しても何もしない（状態の参照も PixelEngine 呼び出しも変わらない）', () => {
    store().createLayer('D', RED, 'direct');
    store().setPixel(2, 2, GREEN);
    const layersBefore = store().layers;
    vi.clearAllMocks();

    store().setPixel(2, 2, { ...GREEN });
    expect(store().layers).toBe(layersBefore);
    expect(engine.setPixel).not.toHaveBeenCalled();
  });

  it('空のピクセルを消去しても何もしない', () => {
    store().createLayer('D', RED, 'direct');
    const layersBefore = store().layers;
    store().setPixel(2, 2, null);
    expect(store().layers).toBe(layersBefore);
    expect(engine.erasePixel).not.toHaveBeenCalled();
  });

  it('変更時は新しい layers 配列・レイヤーオブジェクトを作る（購読側が変更を検知できる）', () => {
    const id = store().createLayer('D', RED, 'direct');
    const layersBefore = store().layers;
    const layerBefore = layerOf(id);
    store().setPixel(0, 0, GREEN);
    expect(store().layers).not.toBe(layersBefore);
    expect(layerOf(id)).not.toBe(layerBefore);
  });

  describe('上書き禁止モード（preservePixels）', () => {
    it('既に色があるピクセルは上書きしない', () => {
      const id = store().createLayer('D', RED, 'direct');
      store().setPixel(0, 0, GREEN);
      store().togglePreservePixels();
      vi.clearAllMocks();

      store().setPixel(0, 0, BLUE);
      expect(pixelOf(id, 0, 0)).toEqual(GREEN);
      expect(engine.setPixel).not.toHaveBeenCalled();
    });

    it('既に色があるピクセルは消去もしない', () => {
      const id = store().createLayer('D', RED, 'direct');
      store().setPixel(0, 0, GREEN);
      store().togglePreservePixels();

      store().setPixel(0, 0, null);
      expect(pixelOf(id, 0, 0)).toEqual(GREEN);
      expect(engine.erasePixel).not.toHaveBeenCalled();
    });

    it('空のピクセルには塗れる', () => {
      const id = store().createLayer('D', RED, 'direct');
      store().togglePreservePixels();
      store().setPixel(1, 1, BLUE);
      expect(pixelOf(id, 1, 1)).toEqual(BLUE);
    });

    it('アルファ 0 のピクセルは「空」とみなして上書きできる', () => {
      const id = store().createLayer('D', RED, 'direct');
      store().setPixel(1, 1, { r: 1, g: 2, b: 3, a: 0 });
      store().togglePreservePixels();
      store().setPixel(1, 1, BLUE);
      expect(pixelOf(id, 1, 1)).toEqual(BLUE);
    });
  });

  describe('アクティブレイヤーがないときの自動作成', () => {
    it('レイヤーがなければ direct レイヤーを自動作成して塗る', () => {
      store().setDrawingColor(GREEN);
      store().setPixel(7, 8, BLUE);

      const s = store();
      expect(s.layers).toHaveLength(1);
      const layer = s.layers[0];
      expect(s.activeLayerId).toBe(layer.id);
      expect(layer).toMatchObject({
        name: '新規レイヤー',
        layerType: 'direct',
        baseColor: GREEN, // 基本色は現在の描画色
        groupId: null,
        order: 0,
        visible: true,
        opacity: 100,
      });
      expect(layer.pixels[8][7]).toEqual(BLUE);
      expect(engine.setPixel).toHaveBeenCalledWith(layer.id, 7, 8, 0, 0, 255, 255);
    });

    it('アクティブレイヤー ID が存在しないレイヤーを指していても自動作成する', () => {
      const existing = store().createLayer('既存', RED, 'direct');
      store().reorderLayer(existing, 4, null);
      store().setActiveLayer('missing-layer');

      store().setPixel(0, 0, BLUE);

      const s = store();
      expect(s.layers).toHaveLength(2);
      const created = s.layers.find((l) => l.id !== existing)!;
      expect(s.activeLayerId).toBe(created.id);
      expect(created.order).toBe(5); // 既存の最大 order + 1
      expect(created.pixels[0][0]).toEqual(BLUE);
      expect(pixelOf(existing, 0, 0)).toBeNull();
    });

    it('アクティブレイヤーを解除していると、既存レイヤーがあっても新規作成する', () => {
      const existing = store().createLayer('既存', RED, 'direct');
      store().setActiveLayer(null);
      store().setPixel(0, 0, BLUE);
      expect(store().layers).toHaveLength(2);
      expect(store().activeLayerId).not.toBe(existing);
      expect(pixelOf(existing, 0, 0)).toBeNull();
    });
  });
});

// ================================================================
// commitDrawing（ストロークの確定）
// ================================================================

describe('commitDrawing', () => {
  it('一連の setPixel をまとめて 1 件の履歴として確定し、プレビューを更新する', () => {
    const id = store().createLayer('D', RED, 'direct');
    const versionBefore = store().previewVersion;

    store().setPixel(0, 0, GREEN);
    store().setPixel(1, 0, GREEN);
    store().setPixel(2, 0, GREEN);
    store().commitDrawing();

    expect(store().history).toHaveLength(1);
    expect(store().historyIndex).toBe(0);
    expect(store().previewVersion).toBe(versionBefore + 1);
    expect(paintedCoords(id)).toEqual(['0,0', '1,0', '2,0']);
  });

  it('何も変更していなければ履歴を追加しない', () => {
    store().createLayer('D', RED, 'direct');
    store().commitDrawing();
    expect(store().history).toHaveLength(0);
  });

  it('確定後の getComposite には描いたピクセルが反映される', () => {
    store().createLayer('D', RED, 'direct');
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT); // キャッシュを作っておく

    store().setPixel(0, 0, GREEN);
    store().commitDrawing();

    expect(compositeAt(0, 0)).toEqual(GREEN);
  });
});

// ================================================================
// setPixelRect
// ================================================================

describe('setPixelRect', () => {
  it('両端を含む矩形を塗る（始点・終点が逆順でもよい）', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixelRect(3, 2, 1, 1, GREEN);
    expect(paintedCoords(id)).toEqual(['1,1', '2,1', '3,1', '1,2', '2,2', '3,2']);
    expect(pixelOf(id, 2, 2)).toEqual(GREEN);
  });

  it('1 点だけの矩形も塗れる', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixelRect(5, 5, 5, 5, GREEN);
    expect(paintedCoords(id)).toEqual(['5,5']);
  });

  it('キャンバス外にはみ出した部分は切り詰め、PixelEngine にも切り詰めた範囲を送る', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixelRect(-5, -3, 1, 0, GREEN);
    expect(paintedCoords(id)).toEqual(['0,0', '1,0']);
    expect(engine.setPixelRect).toHaveBeenCalledWith(id, 0, 0, 1, 0, 0, 255, 0, 255);

    store().setPixelRect(62, 62, 200, 200, BLUE);
    expect(pixelOf(id, 63, 63)).toEqual(BLUE);
    expect(engine.setPixelRect).toHaveBeenLastCalledWith(id, 62, 62, 63, 63, 0, 0, 255, 255);
  });

  it('完全にキャンバス外の矩形ではピクセルを変更せず、履歴も追加しない', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixelRect(70, 70, 80, 80, GREEN);
    expect(paintedCoords(id)).toEqual([]);
    expect(store().history).toHaveLength(0);
  });

  it('singleColor レイヤーでは基本色で塗る', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixelRect(0, 0, 1, 1, BLUE);
    expect(pixelOf(id, 0, 0)).toEqual(RED);
    expect(pixelOf(id, 1, 1)).toEqual(RED);
    expect(engine.setPixelRect).toHaveBeenCalledWith(id, 0, 0, 1, 1, 255, 0, 0, 255);
  });

  it('null で矩形を消去し、PixelEngine.erasePixelRect を呼ぶ', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixelRect(0, 0, 3, 3, GREEN);
    store().setPixelRect(1, 1, 2, 2, null);
    expect(paintedCoords(id)).toHaveLength(16 - 4);
    expect(pixelOf(id, 1, 1)).toBeNull();
    expect(pixelOf(id, 0, 0)).toEqual(GREEN);
    expect(engine.erasePixelRect).toHaveBeenCalledWith(id, 1, 1, 2, 2);
  });

  it('上書き禁止モードでは既に色があるピクセルを残し、空のピクセルだけを塗る', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(1, 0, GREEN);
    store().commitDrawing();
    store().togglePreservePixels();

    store().setPixelRect(0, 0, 2, 0, BLUE);
    expect(pixelOf(id, 0, 0)).toEqual(BLUE);
    expect(pixelOf(id, 1, 0)).toEqual(GREEN);
    expect(pixelOf(id, 2, 0)).toEqual(BLUE);
  });

  it('上書き禁止モードでは矩形消去でも既存ピクセルを消さない', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixelRect(0, 0, 1, 1, GREEN);
    store().togglePreservePixels();
    store().setPixelRect(0, 0, 1, 1, null);
    expect(paintedCoords(id)).toHaveLength(4);
  });

  it('1 回の呼び出しで 1 件の履歴を追加し、プレビューとキャッシュを更新する', () => {
    store().createLayer('D', RED, 'direct');
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT);
    const versionBefore = store().previewVersion;

    store().setPixelRect(0, 0, 9, 9, GREEN);
    expect(store().history).toHaveLength(1);
    expect(store().previewVersion).toBe(versionBefore + 1);
    expect(compositeAt(9, 9)).toEqual(GREEN);

    store().setPixelRect(0, 0, 0, 0, BLUE);
    expect(store().history).toHaveLength(2);
    expect(store().historyIndex).toBe(1);
  });

  it('アクティブレイヤーがなければ direct レイヤーを自動作成して塗る', () => {
    store().setPixelRect(0, 0, 1, 0, BLUE);
    const s = store();
    expect(s.layers).toHaveLength(1);
    expect(s.activeLayerId).toBe(s.layers[0].id);
    expect(s.layers[0].layerType).toBe('direct');
    expect(paintedCoords(s.layers[0].id)).toEqual(['0,0', '1,0']);
  });
});

// ================================================================
// updateLayerColor
// ================================================================

describe('updateLayerColor', () => {
  it('singleColor レイヤーでは基本色と、塗られている全ピクセルの色を変更する', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixelRect(0, 0, 2, 0, RED);

    store().updateLayerColor(id, BLUE);

    const layer = layerOf(id);
    expect(layer.baseColor).toEqual(BLUE);
    expect(layer.pixels[0][0]).toEqual(BLUE);
    expect(layer.pixels[0][1]).toEqual(BLUE);
    expect(layer.pixels[0][2]).toEqual(BLUE);
    // 塗られていないピクセルは透明のまま
    expect(paintedCoords(id)).toEqual(['0,0', '1,0', '2,0']);
  });

  it('singleColor レイヤーではキャンバス端（最終列・最終行）を含む全ピクセルの色を変更する', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    // キャンバス全面を塗る
    store().setPixelRect(0, 0, SKIN_WIDTH - 1, SKIN_HEIGHT - 1, RED);
    store().commitDrawing();
    vi.clearAllMocks();

    store().updateLayerColor(id, BLUE);

    // 四隅
    expect(pixelOf(id, 0, 0)).toEqual(BLUE);
    expect(pixelOf(id, SKIN_WIDTH - 1, 0)).toEqual(BLUE);
    expect(pixelOf(id, 0, SKIN_HEIGHT - 1)).toEqual(BLUE);
    expect(pixelOf(id, SKIN_WIDTH - 1, SKIN_HEIGHT - 1)).toEqual(BLUE);

    // 新しい色になっていないピクセルが 1 つもない
    const notRecolored: string[] = [];
    layerOf(id).pixels.forEach((row, y) => {
      row.forEach((p, x) => {
        if (!p || p.r !== BLUE.r || p.g !== BLUE.g || p.b !== BLUE.b || p.a !== BLUE.a) {
          notRecolored.push(`${x},${y}`);
        }
      });
    });
    expect(notRecolored).toEqual([]);

    // PixelEngine に送るデータでも右上・右下の隅が新しい色になっている
    expect(engine.setLayerData).toHaveBeenCalledTimes(1);
    const data = engine.setLayerData.mock.calls[0][2] as Uint8ClampedArray;
    const at = (x: number, y: number) => {
      const i = (y * SKIN_WIDTH + x) * 4;
      return Array.from(data.slice(i, i + 4));
    };
    expect(at(SKIN_WIDTH - 1, 0)).toEqual([0, 0, 255, 255]);
    expect(at(SKIN_WIDTH - 1, SKIN_HEIGHT - 1)).toEqual([0, 0, 255, 255]);
  });

  it('singleColor レイヤーでもアルファ 0 のピクセルは色を変更しない', () => {
    const id = store().createLayer('S', RED, 'direct');
    store().setPixel(0, 0, { r: 9, g: 9, b: 9, a: 0 });
    store().commitDrawing();
    store().updateLayerType(id, 'singleColor');

    store().updateLayerColor(id, BLUE);
    expect(pixelOf(id, 0, 0)).toEqual({ r: 9, g: 9, b: 9, a: 0 });
  });

  it('direct レイヤーでは基本色だけを変更し、ピクセルはそのまま', () => {
    const id = store().createLayer('D', RED, 'direct');
    store().setPixel(0, 0, GREEN);
    store().commitDrawing();

    store().updateLayerColor(id, BLUE);
    expect(layerOf(id).baseColor).toEqual(BLUE);
    expect(pixelOf(id, 0, 0)).toEqual(GREEN);
  });

  it('変更前のレイヤーオブジェクトのピクセルは書き換えない（不変更新）', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixelRect(0, 0, 0, 0, RED);
    const before = layerOf(id);

    store().updateLayerColor(id, BLUE);
    expect(before.pixels[0][0]).toEqual(RED);
    expect(before.baseColor).toEqual(RED);
    expect(layerOf(id)).not.toBe(before);
  });

  it('他のレイヤーには影響しない', () => {
    const a = store().createLayer('A', RED, 'singleColor');
    store().setPixelRect(0, 0, 0, 0, RED);
    const b = store().createLayer('B', GREEN, 'singleColor');
    store().setPixelRect(1, 1, 1, 1, GREEN);

    store().updateLayerColor(a, BLUE);
    expect(layerOf(b).baseColor).toEqual(GREEN);
    expect(pixelOf(b, 1, 1)).toEqual(GREEN);
  });

  it('PixelEngine に更新後のレイヤーデータを送る', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixelRect(1, 0, 1, 0, RED);
    vi.clearAllMocks();

    store().updateLayerColor(id, { r: 10, g: 20, b: 30, a: 255 });

    expect(engine.setLayerData).toHaveBeenCalledTimes(1);
    const [layerId, order, data] = engine.setLayerData.mock.calls[0] as [string, number, Uint8ClampedArray];
    expect(layerId).toBe(id);
    expect(order).toBe(0);
    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data).toHaveLength(SKIN_WIDTH * SKIN_HEIGHT * 4);
    // (1,0) は新しい色、(0,0) は透明
    expect(Array.from(data.slice(4, 8))).toEqual([10, 20, 30, 255]);
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('プレビューを更新し、合成キャッシュを無効化する', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixelRect(0, 0, 0, 0, RED);
    expect(compositeAt(0, 0)).toEqual(RED);
    const versionBefore = store().previewVersion;

    store().updateLayerColor(id, GREEN);
    expect(store().previewVersion).toBe(versionBefore + 1);
    expect(compositeAt(0, 0)).toEqual(GREEN);
  });

  it('存在しないレイヤーを指定しても何もしない', () => {
    store().createLayer('S', RED);
    const stateBefore = store();
    store().updateLayerColor('missing', BLUE);
    expect(store()).toBe(stateBefore);
    expect(engine.setLayerData).not.toHaveBeenCalled();
  });

  it('それ自体では履歴を追加せず、続けて何度変更しても saveToHistory で 1 件にまとまる', () => {
    const id = store().createLayer('S', RED, 'singleColor');
    store().setPixelRect(0, 0, 0, 0, RED);
    const historyBefore = store().history.length;

    // カラーピッカーのドラッグ中を想定
    store().updateLayerColor(id, { r: 200, g: 0, b: 0, a: 255 });
    store().updateLayerColor(id, { r: 100, g: 0, b: 0, a: 255 });
    store().updateLayerColor(id, BLUE);
    expect(store().history).toHaveLength(historyBefore);

    store().saveToHistory();
    expect(store().history).toHaveLength(historyBefore + 1);

    // 1 回の undo でドラッグ開始前の色に戻る
    store().undo();
    expect(layerOf(id).baseColor).toEqual(RED);
    expect(pixelOf(id, 0, 0)).toEqual(RED);
  });
});

// ================================================================
// レイヤーのプロパティ変更・削除
// ================================================================

describe('レイヤーのプロパティ変更', () => {
  it('updateLayerName は対象レイヤーの名前だけを変更する', () => {
    const a = store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    store().updateLayerName(a, '髪');
    expect(layerOf(a).name).toBe('髪');
    expect(layerOf(b).name).toBe('B');
  });

  it('updateLayerType で描画モードを切り替えると setPixel の挙動が変わる', () => {
    const id = store().createLayer('L', RED, 'singleColor');
    store().updateLayerType(id, 'direct');
    expect(layerOf(id).layerType).toBe('direct');
    store().setPixel(0, 0, BLUE);
    expect(pixelOf(id, 0, 0)).toEqual(BLUE);

    store().updateLayerType(id, 'singleColor');
    store().setPixel(1, 0, BLUE);
    expect(pixelOf(id, 1, 0)).toEqual(RED);
  });

  it.each([
    [50, 50],
    [0, 0],
    [100, 100],
    [-10, 0],
    [150, 100],
  ])('updateLayerOpacity(%i) は不透明度を 0〜100 に丸めて %i にする', (input, expected) => {
    const id = store().createLayer('L', RED);
    store().updateLayerOpacity(id, input);
    expect(layerOf(id).opacity).toBe(expected);
  });

  it('updateLayerOpacity は合成結果に反映される', () => {
    const id = store().createLayer('L', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    expect(compositeAt(0, 0)).toEqual(RED);
    const versionBefore = store().previewVersion;

    store().updateLayerOpacity(id, 50);
    expect(store().previewVersion).toBe(versionBefore + 1);
    expect(compositeAt(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 128 });
  });

  it('toggleLayerVisibility は表示を切り替え、合成結果に反映される', () => {
    const id = store().createLayer('L', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    expect(compositeAt(0, 0)).toEqual(RED);

    store().toggleLayerVisibility(id);
    expect(layerOf(id).visible).toBe(false);
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT);

    store().toggleLayerVisibility(id);
    expect(layerOf(id).visible).toBe(true);
    expect(compositeAt(0, 0)).toEqual(RED);
  });

  it('setActiveLayer / setHighlightedLayer / setDrawingColor は値をそのまま設定する', () => {
    const id = store().createLayer('L', RED);
    store().setActiveLayer(null);
    expect(store().activeLayerId).toBeNull();
    store().setActiveLayer(id);
    expect(store().activeLayerId).toBe(id);

    store().setHighlightedLayer(id);
    expect(store().highlightedLayerId).toBe(id);
    store().setHighlightedLayer(null);
    expect(store().highlightedLayerId).toBeNull();

    store().setDrawingColor(BLUE);
    expect(store().drawingColor).toEqual(BLUE);
  });
});

describe('deleteLayer', () => {
  it('レイヤーを削除し、PixelEngine からも削除する', () => {
    const a = store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    store().deleteLayer(a);
    expect(store().layers.map((l) => l.id)).toEqual([b]);
    expect(engine.deleteLayer).toHaveBeenCalledWith(a);
  });

  it('アクティブレイヤーを削除するとアクティブが解除される', () => {
    store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    store().deleteLayer(b);
    expect(store().activeLayerId).toBeNull();
  });

  it('アクティブでないレイヤーを削除してもアクティブはそのまま', () => {
    const a = store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    store().deleteLayer(a);
    expect(store().activeLayerId).toBe(b);
  });

  it('削除したレイヤーのピクセルは合成結果から消える', () => {
    const id = store().createLayer('A', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    expect(compositeAt(0, 0)).toEqual(RED);
    const versionBefore = store().previewVersion;

    store().deleteLayer(id);
    expect(store().previewVersion).toBe(versionBefore + 1);
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT);
  });
});

// ================================================================
// duplicateLayer
// ================================================================

// 注: 複製が履歴に記録されない不具合（saveToHistory が変更前に呼ばれる）があるため、履歴は検証しない
describe('duplicateLayer', () => {
  function setupSource() {
    const groupId = store().createLayerGroup('服');
    const src = store().createLayer('シャツ', RED, 'direct');
    store().setPixelRect(0, 0, 1, 0, GREEN);
    store().moveLayerToGroup(src, groupId);
    store().updateLayerOpacity(src, 70);
    store().createLayer('その他', BLUE); // order 1
    return { src, groupId };
  }

  it('「〜 のコピー」という名前で複製し、新しい ID を返してアクティブにする', () => {
    const { src } = setupSource();
    const newId = store().duplicateLayer(src);

    expect(newId).not.toBeNull();
    expect(newId).not.toBe(src);
    expect(store().layers).toHaveLength(3);
    expect(store().activeLayerId).toBe(newId);
    expect(layerOf(newId!).name).toBe('シャツ のコピー');
  });

  it('描画モード・基本色・不透明度・表示状態・ピクセルを引き継ぐ', () => {
    const { src } = setupSource();
    const newId = store().duplicateLayer(src)!;
    const source = layerOf(src);
    const copy = layerOf(newId);

    expect(copy.layerType).toBe(source.layerType);
    expect(copy.baseColor).toEqual(source.baseColor);
    expect(copy.noiseSettings).toEqual(source.noiseSettings);
    expect(copy.opacity).toBe(70);
    expect(copy.visible).toBe(source.visible);
    expect(copy.pixels).toEqual(source.pixels);
    expect(paintedCoords(newId)).toEqual(['0,0', '1,0']);
  });

  it('グループには属さず、order は全レイヤーの最大値 + 1 になる', () => {
    const { src } = setupSource();
    const maxOrder = Math.max(...store().layers.map((l) => l.order));
    const newId = store().duplicateLayer(src)!;
    expect(layerOf(newId).groupId).toBeNull();
    expect(layerOf(newId).order).toBe(maxOrder + 1);
  });

  it('複製したピクセル・色は元のレイヤーと独立している', () => {
    const { src } = setupSource();
    const newId = store().duplicateLayer(src)!;
    expect(layerOf(newId).pixels).not.toBe(layerOf(src).pixels);
    expect(layerOf(newId).baseColor).not.toBe(layerOf(src).baseColor);

    // 複製側（アクティブ）に描いても元のレイヤーは変わらない
    store().setPixel(5, 5, BLUE);
    store().setPixel(0, 0, null);
    store().commitDrawing();
    expect(pixelOf(newId, 5, 5)).toEqual(BLUE);
    expect(pixelOf(src, 5, 5)).toBeNull();
    expect(pixelOf(src, 0, 0)).toEqual(GREEN);
  });

  it('PixelEngine でもレイヤーを複製する', () => {
    const { src } = setupSource();
    const maxOrder = Math.max(...store().layers.map((l) => l.order));
    const newId = store().duplicateLayer(src)!;
    expect(engine.duplicateLayer).toHaveBeenCalledWith(src, newId, maxOrder + 1);
  });

  it('プレビューを更新し、合成キャッシュを無効化する', () => {
    const { src } = setupSource();
    store().toggleLayerVisibility(src);
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT);
    const versionBefore = store().previewVersion;

    // 非表示レイヤーの複製も非表示のまま
    const hiddenCopy = store().duplicateLayer(src)!;
    expect(layerOf(hiddenCopy).visible).toBe(false);
    expect(store().previewVersion).toBe(versionBefore + 1);

    store().toggleLayerVisibility(hiddenCopy);
    // 不透明度 70% を引き継いでいる（255 * 0.7 ≒ 179）
    expect(compositeAt(0, 0)).toEqual({ ...GREEN, a: 179 });
  });

  it('存在しないレイヤーを指定すると null を返し、何も変更しない', () => {
    setupSource();
    const stateBefore = store();
    expect(store().duplicateLayer('missing')).toBeNull();
    expect(store()).toBe(stateBefore);
    expect(engine.duplicateLayer).not.toHaveBeenCalled();
  });
});

// ================================================================
// レイヤーの並べ替え
// ================================================================

describe('reorderLayer', () => {
  it('order とグループを変更する', () => {
    const groupId = store().createLayerGroup('G');
    const id = store().createLayer('L', RED);
    store().reorderLayer(id, 7, groupId);
    expect(layerOf(id)).toMatchObject({ order: 7, groupId });

    store().reorderLayer(id, 2, null);
    expect(layerOf(id)).toMatchObject({ order: 2, groupId: null });
  });

  it('前後関係の変更が合成結果に反映される（order が小さいほど手前）', () => {
    const red = store().createLayer('赤', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    store().createLayer('青', BLUE, 'direct');
    store().setPixelRect(0, 0, 0, 0, BLUE);
    expect(compositeAt(0, 0)).toEqual(RED);

    store().reorderLayer(red, 5, null);
    expect(compositeAt(0, 0)).toEqual(BLUE);
  });

  it('他のレイヤーは変更しない', () => {
    const a = store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    const bBefore = layerOf(b);
    store().reorderLayer(a, 9, null);
    expect(layerOf(b)).toBe(bBefore);
  });
});

// ================================================================
// レイヤーグループ
// ================================================================

describe('レイヤーグループ', () => {
  it('createLayerGroup は展開・表示状態のグループを作成し、ID を返す', () => {
    const id = store().createLayerGroup('頭');
    expect(store().layerGroups).toEqual([
      { id, name: '頭', collapsed: false, order: 0, visible: true },
    ]);
  });

  it('グループの order は既存グループの最大値 + 1 になる', () => {
    const g1 = store().createLayerGroup('1');
    const g2 = store().createLayerGroup('2');
    expect(store().layerGroups.map((g) => g.order)).toEqual([0, 1]);
    expect(g1).not.toBe(g2);

    store().reorderLayerGroup(g1, 10);
    const g3 = store().createLayerGroup('3');
    expect(store().layerGroups.find((g) => g.id === g3)!.order).toBe(11);
  });

  it('グループの作成はアクティブレイヤーを変えない', () => {
    const layerId = store().createLayer('L', RED);
    store().createLayerGroup('G');
    expect(store().activeLayerId).toBe(layerId);
  });

  it('updateLayerGroupName は対象グループの名前だけを変更する', () => {
    const g1 = store().createLayerGroup('1');
    const g2 = store().createLayerGroup('2');
    store().updateLayerGroupName(g1, '腕');
    expect(store().layerGroups.map((g) => g.name)).toEqual(['腕', '2']);
    expect(store().layerGroups.find((g) => g.id === g2)!.name).toBe('2');
  });

  it('toggleLayerGroupCollapsed は折りたたみ状態を切り替える', () => {
    const g = store().createLayerGroup('G');
    store().toggleLayerGroupCollapsed(g);
    expect(store().layerGroups[0].collapsed).toBe(true);
    store().toggleLayerGroupCollapsed(g);
    expect(store().layerGroups[0].collapsed).toBe(false);
  });

  it('toggleLayerGroupVisibility はグループ内のレイヤーを合成から除外する', () => {
    const g = store().createLayerGroup('G');
    const inGroup = store().createLayer('中', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    store().moveLayerToGroup(inGroup, g);
    store().createLayer('外', BLUE, 'direct');
    store().setPixelRect(1, 0, 1, 0, BLUE);
    expect(compositeAt(0, 0)).toEqual(RED);
    const versionBefore = store().previewVersion;

    store().toggleLayerGroupVisibility(g);
    expect(store().layerGroups[0].visible).toBe(false);
    expect(store().previewVersion).toBe(versionBefore + 1);
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT);
    expect(compositeAt(1, 0)).toEqual(BLUE); // グループ外は影響なし
    // レイヤー自体の表示フラグは変えない
    expect(layerOf(inGroup).visible).toBe(true);

    store().toggleLayerGroupVisibility(g);
    expect(compositeAt(0, 0)).toEqual(RED);
  });

  it('reorderLayerGroup は対象グループの order だけを変更する', () => {
    const g1 = store().createLayerGroup('1');
    const g2 = store().createLayerGroup('2');
    store().reorderLayerGroup(g2, -1);
    expect(store().layerGroups.find((g) => g.id === g1)!.order).toBe(0);
    expect(store().layerGroups.find((g) => g.id === g2)!.order).toBe(-1);
  });

  describe('deleteLayerGroup', () => {
    it('グループを削除し、所属レイヤーはグループなしにする（レイヤー自体は残す）', () => {
      const g1 = store().createLayerGroup('1');
      const g2 = store().createLayerGroup('2');
      const a = store().createLayer('A', RED);
      const b = store().createLayer('B', RED);
      const c = store().createLayer('C', RED);
      store().moveLayerToGroup(a, g1);
      store().moveLayerToGroup(b, g2);

      store().deleteLayerGroup(g1);

      expect(store().layerGroups.map((g) => g.id)).toEqual([g2]);
      expect(store().layers).toHaveLength(3);
      expect(layerOf(a).groupId).toBeNull();
      expect(layerOf(b).groupId).toBe(g2);
      expect(layerOf(c).groupId).toBeNull();
    });

    it('存在しないグループを指定してもグループ・レイヤーは変わらない', () => {
      const g = store().createLayerGroup('1');
      const a = store().createLayer('A', RED);
      store().moveLayerToGroup(a, g);
      store().deleteLayerGroup('missing');
      expect(store().layerGroups).toHaveLength(1);
      expect(layerOf(a).groupId).toBe(g);
    });
  });

  describe('moveLayerToGroup', () => {
    it('移動先グループ内の最大 order + 1 の位置（最背面）に移動する', () => {
      const g = store().createLayerGroup('G');
      const a = store().createLayer('A', RED);
      const b = store().createLayer('B', RED);
      const c = store().createLayer('C', RED);
      store().reorderLayer(a, 0, g);
      store().reorderLayer(b, 5, g);

      store().moveLayerToGroup(c, g);
      expect(layerOf(c)).toMatchObject({ groupId: g, order: 6 });
    });

    it('空のグループへ移動すると order は 0 になる', () => {
      const g = store().createLayerGroup('G');
      store().createLayer('A', RED);
      const b = store().createLayer('B', RED);
      store().moveLayerToGroup(b, g);
      expect(layerOf(b)).toMatchObject({ groupId: g, order: 0 });
    });

    it('null を指定するとグループから外し、グループなしレイヤーの最大 order + 1 にする', () => {
      const g = store().createLayerGroup('G');
      const a = store().createLayer('A', RED); // order 0
      const b = store().createLayer('B', RED); // order 1
      store().createLayer('C', RED); // order 2
      store().moveLayerToGroup(a, g);

      store().moveLayerToGroup(a, null);
      expect(layerOf(a)).toMatchObject({ groupId: null, order: 3 });
      expect(layerOf(b).order).toBe(1);
    });

    it('存在しないレイヤーを指定しても何も変わらない', () => {
      const g = store().createLayerGroup('G');
      store().createLayer('A', RED);
      const layersBefore = store().layers;
      store().moveLayerToGroup('missing', g);
      expect(store().layers).toBe(layersBefore);
    });
  });
});

// ================================================================
// パレット
// ================================================================

describe('パレット', () => {
  it('addToPalette は色（と名前）を追加して ID を返す', () => {
    const id1 = store().addToPalette(RED, '赤');
    const id2 = store().addToPalette(BLUE);
    expect(id1).not.toBe(id2);
    expect(store().palette).toEqual([
      { id: id1, color: RED, name: '赤' },
      { id: id2, color: BLUE, name: undefined },
    ]);
  });

  it('addToPalette は色をコピーして保存する（呼び出し側の変更の影響を受けない）', () => {
    const color = { ...GREEN };
    store().addToPalette(color);
    color.g = 0;
    expect(store().palette[0].color).toEqual(GREEN);
  });

  it('同じ色を追加しても別エントリになる', () => {
    store().addToPalette(RED);
    store().addToPalette(RED);
    expect(store().palette).toHaveLength(2);
  });

  it('removeFromPalette は指定したエントリだけを削除する', () => {
    const a = store().addToPalette(RED);
    const b = store().addToPalette(GREEN);
    const c = store().addToPalette(BLUE);
    store().removeFromPalette(b);
    expect(store().palette.map((p) => p.id)).toEqual([a, c]);

    store().removeFromPalette('missing');
    expect(store().palette.map((p) => p.id)).toEqual([a, c]);
  });

  it('updatePaletteColor は指定したエントリの色だけを変更し、名前は保持する', () => {
    const a = store().addToPalette(RED, '赤');
    const b = store().addToPalette(GREEN);
    const newColor = { r: 1, g: 2, b: 3, a: 4 };
    store().updatePaletteColor(a, newColor);
    newColor.r = 200; // 呼び出し側の変更の影響を受けない

    expect(store().palette.find((p) => p.id === a)).toEqual({
      id: a,
      color: { r: 1, g: 2, b: 3, a: 4 },
      name: '赤',
    });
    expect(store().palette.find((p) => p.id === b)!.color).toEqual(GREEN);
  });

  it('renamePaletteColor は前後の空白を取り除いて名前を設定する', () => {
    const a = store().addToPalette(RED);
    store().renamePaletteColor(a, '  肌色  ');
    expect(store().palette[0].name).toBe('肌色');
  });

  it.each(['', '   ', '\t\n'])(
    'renamePaletteColor で空（%j）にすると名前なし（undefined）になる',
    (name) => {
      const a = store().addToPalette(RED, '赤');
      store().renamePaletteColor(a, name);
      expect(store().palette[0].name).toBeUndefined();
      expect(store().palette[0].color).toEqual(RED);
    },
  );

  it('renamePaletteColor は他のエントリの名前を変えない', () => {
    const a = store().addToPalette(RED, '赤');
    store().addToPalette(BLUE, '青');
    store().renamePaletteColor(a, 'レッド');
    expect(store().palette.map((p) => p.name)).toEqual(['レッド', '青']);
  });

  it('clearPalette はすべてのエントリを削除する', () => {
    store().addToPalette(RED);
    store().addToPalette(BLUE);
    store().clearPalette();
    expect(store().palette).toEqual([]);
  });

  it('パレット操作は履歴に記録しない', () => {
    const a = store().addToPalette(RED);
    store().renamePaletteColor(a, 'x');
    store().removeFromPalette(a);
    expect(store().history).toHaveLength(0);
  });
});

// ================================================================
// ツール切り替えとスポイト
// ================================================================

describe('setActiveTool', () => {
  it('スポイト以外のツールへ切り替えても戻り先（previousTool）は変わらない', () => {
    store().setActiveTool('eraser');
    expect(store().activeTool).toBe('eraser');
    expect(store().previousTool).toBe('pencil');
  });

  it('スポイトに切り替えると直前のツールを戻り先として記録する', () => {
    store().setActiveTool('rectangle');
    store().setActiveTool('eyedropper');
    expect(store().activeTool).toBe('eyedropper');
    expect(store().previousTool).toBe('rectangle');
  });

  it('スポイト選択中にもう一度スポイトを選んでも戻り先は変わらない', () => {
    store().setActiveTool('eraser');
    store().setActiveTool('eyedropper');
    store().setActiveTool('eyedropper');
    expect(store().activeTool).toBe('eyedropper');
    expect(store().previousTool).toBe('eraser');
  });

  it('スポイト以外のツールに切り替えるとレイヤー基本色の取得を終了する', () => {
    const id = store().createLayer('L', RED);
    store().startLayerColorPick(id);
    store().setActiveTool('rectangleEraser');
    expect(store().activeTool).toBe('rectangleEraser');
    expect(store().layerColorPickTarget).toBeNull();
  });

  it('基本色の取得中にスポイトを選び直しても取得は継続する', () => {
    const id = store().createLayer('L', RED);
    store().setActiveTool('eraser');
    store().startLayerColorPick(id);
    store().setActiveTool('eyedropper');
    expect(store().layerColorPickTarget).toBe(id);
    expect(store().previousTool).toBe('eraser');
  });
});

describe('applyPickedColor', () => {
  describe('基本色の取得中でないとき', () => {
    it('描画色に反映し、直前のツールに戻す', () => {
      store().setActiveTool('rectangle');
      store().setActiveTool('eyedropper');

      store().applyPickedColor(BLUE);
      expect(store().drawingColor).toEqual(BLUE);
      expect(store().activeTool).toBe('rectangle');
      expect(store().layerColorPickTarget).toBeNull();
    });

    it('描画色は渡した色のコピーになる', () => {
      store().setActiveTool('eyedropper');
      const color = { ...GREEN };
      store().applyPickedColor(color);
      color.g = 1;
      expect(store().drawingColor).toEqual(GREEN);
    });

    it('レイヤーや履歴は変更しない', () => {
      const id = store().createLayer('L', RED);
      store().setActiveTool('eyedropper');
      store().applyPickedColor(BLUE);
      expect(layerOf(id).baseColor).toEqual(RED);
      expect(store().history).toHaveLength(0);
    });
  });

  describe('レイヤー基本色の取得中のとき', () => {
    function setupPick() {
      const id = store().createLayer('服', RED, 'singleColor');
      store().setPixelRect(0, 0, 1, 0, RED);
      store().setDrawingColor(GREEN);
      store().setActiveTool('eraser');
      store().startLayerColorPick(id);
      return id;
    }

    it('対象レイヤーの基本色（singleColor なら塗られたピクセルも）を変更する', () => {
      const id = setupPick();
      store().applyPickedColor(BLUE);
      expect(layerOf(id).baseColor).toEqual(BLUE);
      expect(pixelOf(id, 0, 0)).toEqual(BLUE);
      expect(pixelOf(id, 1, 0)).toEqual(BLUE);
    });

    it('描画色は変更しない', () => {
      setupPick();
      store().applyPickedColor(BLUE);
      expect(store().drawingColor).toEqual(GREEN);
    });

    it('直前のツールに戻し、取得を終了する', () => {
      setupPick();
      store().applyPickedColor(BLUE);
      expect(store().activeTool).toBe('eraser');
      expect(store().layerColorPickTarget).toBeNull();
    });

    it('履歴を 1 件だけ追加し、undo で元の基本色に戻せる', () => {
      const id = setupPick();
      const historyBefore = store().history.length;

      store().applyPickedColor(BLUE);
      expect(store().history).toHaveLength(historyBefore + 1);
      expect(store().historyIndex).toBe(historyBefore);

      store().undo();
      expect(layerOf(id).baseColor).toEqual(RED);
      expect(pixelOf(id, 0, 0)).toEqual(RED);
    });

    it('基本色に渡した色のコピーを使う', () => {
      const id = setupPick();
      const color = { ...BLUE };
      store().applyPickedColor(color);
      color.b = 7;
      expect(layerOf(id).baseColor).toEqual(BLUE);
    });

    it('他のレイヤーには影響しない', () => {
      const other = store().createLayer('他', GREEN, 'singleColor');
      store().setPixelRect(5, 5, 5, 5, GREEN);
      setupPick();
      store().applyPickedColor(BLUE);
      expect(layerOf(other).baseColor).toEqual(GREEN);
      expect(pixelOf(other, 5, 5)).toEqual(GREEN);
    });
  });

  describe('対象レイヤーが削除されていたとき', () => {
    it('通常のスポイトとして描画色に反映し、ツールを戻して取得を終了する', () => {
      const id = store().createLayer('消える', RED);
      store().setActiveTool('rectangle');
      store().startLayerColorPick(id);
      store().deleteLayer(id);
      const historyBefore = store().history.length;

      store().applyPickedColor(BLUE);
      expect(store().drawingColor).toEqual(BLUE);
      expect(store().activeTool).toBe('rectangle');
      expect(store().layerColorPickTarget).toBeNull();
      expect(store().history).toHaveLength(historyBefore);
    });
  });
});

describe('startLayerColorPick / endLayerColorPick', () => {
  it('startLayerColorPick は対象レイヤーを記録してスポイトに切り替える', () => {
    const id = store().createLayer('L', RED);
    store().setActiveTool('rectangle');
    store().startLayerColorPick(id);
    expect(store().layerColorPickTarget).toBe(id);
    expect(store().activeTool).toBe('eyedropper');
    expect(store().previousTool).toBe('rectangle');
  });

  it('既にスポイト選択中なら戻り先（previousTool）を維持する', () => {
    const id = store().createLayer('L', RED);
    store().setActiveTool('eraser');
    store().setActiveTool('eyedropper');
    store().startLayerColorPick(id);
    expect(store().activeTool).toBe('eyedropper');
    expect(store().previousTool).toBe('eraser');
  });

  it('取得中に別のレイヤーで開始し直すと対象が切り替わる', () => {
    const a = store().createLayer('A', RED);
    const b = store().createLayer('B', RED);
    store().setActiveTool('eraser');
    store().startLayerColorPick(a);
    store().startLayerColorPick(b);
    expect(store().layerColorPickTarget).toBe(b);
    expect(store().previousTool).toBe('eraser');
  });

  it('endLayerColorPick は取得をキャンセルして直前のツールに戻す（色は変えない）', () => {
    const id = store().createLayer('L', RED);
    store().setActiveTool('rectangle');
    store().startLayerColorPick(id);

    store().endLayerColorPick();
    expect(store().layerColorPickTarget).toBeNull();
    expect(store().activeTool).toBe('rectangle');
    expect(layerOf(id).baseColor).toEqual(RED);
    expect(store().drawingColor).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(store().history).toHaveLength(0);
  });
});

// ================================================================
// 設定
// ================================================================

describe('設定', () => {
  it('setCanvasBackground は背景を設定する（市松模様・単色）', () => {
    store().setCanvasBackground({ type: 'checker', variant: 'dark' });
    expect(store().canvasBackground).toEqual({ type: 'checker', variant: 'dark' });

    store().setCanvasBackground({ type: 'solid', color: '#ff00ff' });
    expect(store().canvasBackground).toEqual({ type: 'solid', color: '#ff00ff' });
  });

  it('setCanvasBackground は合成結果・履歴に影響しない', () => {
    store().createLayer('L', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    const composite = store().getComposite();
    const historyLength = store().history.length;

    store().setCanvasBackground({ type: 'solid', color: '#000000' });
    expect(store().getComposite()).toBe(composite);
    expect(store().history).toHaveLength(historyLength);
  });

  it('togglePreservePixels / toggleLayer2 は真偽値を反転する', () => {
    store().togglePreservePixels();
    expect(store().preservePixels).toBe(true);
    store().togglePreservePixels();
    expect(store().preservePixels).toBe(false);

    store().toggleLayer2();
    expect(store().showLayer2).toBe(false);
    store().toggleLayer2();
    expect(store().showLayer2).toBe(true);
  });

  it('setModelType / setTheme は値を設定する', () => {
    store().setModelType('alex');
    expect(store().modelType).toBe('alex');
    store().setTheme('dark');
    expect(store().theme).toBe('dark');
  });
});

// ================================================================
// getComposite のキャッシュ
// ================================================================

describe('getComposite', () => {
  it('レイヤーがなければ 64x64 の全面透明を返す', () => {
    const composite = store().getComposite();
    expect(composite).toHaveLength(SKIN_HEIGHT);
    expect(composite.every((row) => row.length === SKIN_WIDTH)).toBe(true);
    expect(composite.flat().every((p) => p.a === 0)).toBe(true);
  });

  it('計算結果をキャッシュし、変更がなければ同じオブジェクトを返す', () => {
    store().createLayer('L', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);

    const first = store().getComposite();
    expect(store().compositeCache).toBe(first);
    expect(store().getComposite()).toBe(first);
  });

  it('合成に関係しない操作ではキャッシュを保持する', () => {
    const id = store().createLayer('L', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    const first = store().getComposite();

    // （レイヤー名の変更などレイヤー配列が作り直される操作では、安全のため再計算される）
    store().setActiveTool('eraser');
    store().setDrawingColor(BLUE);
    store().addToPalette(GREEN);
    store().setHighlightedLayer(id);
    expect(store().getComposite()).toBe(first);
  });

  // 各操作の後、キャッシュが無効化され新しい合成結果が返ること
  it.each<[string, (id: string) => void]>([
    ['reorderLayerGroup', (id) => {
      const g = store().createLayerGroup('G');
      store().moveLayerToGroup(id, g);
      store().getComposite();
      store().reorderLayerGroup(g, 3);
    }],
    ['moveLayerToGroup', (id) => { store().moveLayerToGroup(id, store().createLayerGroup('G')); }],
    ['deleteLayerGroup', (id) => {
      const g = store().createLayerGroup('G');
      store().moveLayerToGroup(id, g);
      store().getComposite();
      store().deleteLayerGroup(g);
    }],
    ['createLayer', () => { store().createLayer('新', BLUE); }],
    ['setPixelRect', () => store().setPixelRect(1, 1, 1, 1, BLUE)],
    ['commitDrawing', () => store().commitDrawing()],
    ['updateLayerColor', (id) => store().updateLayerColor(id, BLUE)],
    ['updateLayerOpacity', (id) => store().updateLayerOpacity(id, 10)],
    ['toggleLayerVisibility', (id) => store().toggleLayerVisibility(id)],
    ['deleteLayer', (id) => store().deleteLayer(id)],
    ['reorderLayer', (id) => store().reorderLayer(id, 3, null)],
    ['duplicateLayer', (id) => { store().duplicateLayer(id); }],
    ['toggleLayerGroupVisibility', () => {
      const g = store().createLayerGroup('G');
      store().toggleLayerGroupVisibility(g);
    }],
  ])('%s の後はキャッシュを無効化して再計算する', (_name, action) => {
    const id = store().createLayer('L', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    const first = store().getComposite();

    action(id);
    expect(store().compositeCache).toBeNull();
    expect(store().getComposite()).not.toBe(first);
  });
});

// ================================================================
// 重なり順・グループの変更と合成結果（キャンバス・3D・PNG 書き出しが使う）
// ================================================================
describe('重なり順・グループを変える操作と合成結果', () => {
  // (0,0) に赤と青を塗った 2 レイヤーを作る（赤が手前: order が小さい）
  function twoLayers() {
    const red = store().createLayer('赤', RED, 'direct');
    store().setPixelRect(0, 0, 0, 0, RED);
    const blue = store().createLayer('青', BLUE, 'direct');
    store().setPixelRect(0, 0, 0, 0, BLUE);
    // createLayer は order を増やしていくので、赤（order 0）が手前・青（order 1）が奥
    store().commitDrawing();
    return { red, blue };
  }

  it('reorderLayer で重なり順を変えると、合成結果が変わりプレビューが更新される', () => {
    const { red } = twoLayers();
    expect(compositeAt(0, 0)).toEqual(RED);
    const version = store().previewVersion;

    store().reorderLayer(red, 5, null);

    expect(compositeAt(0, 0)).toEqual(BLUE);
    expect(store().previewVersion).toBeGreaterThan(version);
  });

  it('moveLayerToGroup でグループに入れると（グループ内は手前に来るため）合成結果が変わりプレビューが更新される', () => {
    const { blue } = twoLayers();
    const group = store().createLayerGroup('グループ');
    expect(compositeAt(0, 0)).toEqual(RED);
    const version = store().previewVersion;

    store().moveLayerToGroup(blue, group);

    expect(compositeAt(0, 0)).toEqual(BLUE);
    expect(store().previewVersion).toBeGreaterThan(version);
  });

  it('reorderLayerGroup でグループの順番を変えると、合成結果が変わりプレビューが更新される', () => {
    const { red, blue } = twoLayers();
    const g1 = store().createLayerGroup('1');
    const g2 = store().createLayerGroup('2');
    store().moveLayerToGroup(red, g1);
    store().moveLayerToGroup(blue, g2);
    expect(compositeAt(0, 0)).toEqual(RED);
    const version = store().previewVersion;

    store().reorderLayerGroup(g1, 5);

    expect(compositeAt(0, 0)).toEqual(BLUE);
    expect(store().previewVersion).toBeGreaterThan(version);
  });

  it('非表示のグループを削除すると、中のレイヤーが表示され、プレビューが更新される', () => {
    const { red, blue } = twoLayers();
    store().toggleLayerVisibility(blue);
    const group = store().createLayerGroup('非表示');
    store().moveLayerToGroup(red, group);
    store().toggleLayerGroupVisibility(group);
    expect(compositeAt(0, 0)).toEqual(TRANSPARENT);
    const version = store().previewVersion;

    store().deleteLayerGroup(group);

    expect(compositeAt(0, 0)).toEqual(RED);
    expect(store().previewVersion).toBeGreaterThan(version);
  });

  it('合成結果のキャッシュは、レイヤー・グループが変わっていれば（キャッシュの破棄を忘れた操作でも）使われない', () => {
    const { red } = twoLayers();
    expect(compositeAt(0, 0)).toEqual(RED);
    // compositeCache を破棄せずにレイヤーを差し替える
    useEditorStore.setState((state) => ({
      layers: state.layers.map((l) => (l.id === red ? { ...l, visible: false } : l)),
    }));
    expect(compositeAt(0, 0)).toEqual(BLUE);
  });
});
