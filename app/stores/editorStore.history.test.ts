// editorStore の履歴（差分ベースの undo/redo）のテスト
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Web Worker を起動しないよう PixelEngine をモックに差し替える
vi.mock('../lib/pixelEngine', () => import('../test/pixelEngineMock'));

import { engine } from '../test/pixelEngineMock';
import { useEditorStore } from './editorStore';
import {
  MAX_HISTORY,
  SKIN_HEIGHT,
  SKIN_WIDTH,
  type HistoryEntry,
  type Layer,
  type LayerGroup,
  type LayerPixels,
  type RGBA,
} from '../types/editor';

// ---- ヘルパー ----

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
const HALF_YELLOW: RGBA = { r: 250, g: 240, b: 10, a: 128 };

const s = () => useEditorStore.getState();

function getLayer(id: string): Layer {
  const layer = s().layers.find((l) => l.id === id);
  if (!layer) throw new Error(`レイヤー ${id} が見つかりません`);
  return layer;
}

function px(layerId: string, x: number, y: number): RGBA | null {
  return getLayer(layerId).pixels[y][x];
}

// 描画用の direct レイヤーを作ってアクティブにする
function createDirectLayer(name = 'テスト'): string {
  return s().createLayer(name, WHITE, 'direct');
}

// 1 回のストローク（複数の setPixel → commitDrawing）
function stroke(points: [number, number][], color: RGBA | null) {
  for (const [x, y] of points) s().setPixel(x, y, color);
  s().commitDrawing();
}

function emptyPixels(): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () => Array.from({ length: SKIN_WIDTH }, () => null));
}

function makeLayer(overrides: Partial<Layer> & { id: string }): Layer {
  return {
    name: 'レイヤー',
    baseColor: { ...WHITE },
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
  return { name: 'グループ', collapsed: false, order: 0, visible: true, ...overrides };
}

function setHistory(history: HistoryEntry[], historyIndex = history.length - 1) {
  useEditorStore.setState({ history, historyIndex });
}

// ツールバーと同じ判定（Toolbar.tsx）
const canUndo = () => s().historyIndex >= 0;
const canRedo = () => s().historyIndex < s().history.length - 1;

// 操作の前後でストアの状態オブジェクトが変わったか（set が呼ばれたか）
function changesState(action: () => void): boolean {
  const before = useEditorStore.getState();
  action();
  return useEditorStore.getState() !== before;
}

function resetStore() {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  // 前のテストで確定されずに残った描画セッション（スナップショット）があれば確定して破棄し、
  // 改めて初期状態に戻す
  useEditorStore.getState().saveToHistory();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  vi.clearAllMocks();
}

beforeAll(async () => {
  // IndexedDB からの読み込み（非同期）がテストの途中で状態を置き換えないよう、完了を待つ
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
  resetStore();
});

// ---- テスト ----

describe('初期状態', () => {
  it('履歴は空で historyIndex は -1（履歴なし）', () => {
    expect(s().history).toEqual([]);
    expect(s().historyIndex).toBe(-1);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it('履歴が空のとき undo / redo は状態を変えず、エンジンにも何も送らない', () => {
    createDirectLayer();
    vi.clearAllMocks();

    expect(changesState(() => s().undo())).toBe(false);
    expect(changesState(() => s().redo())).toBe(false);

    for (const fn of Object.values(engine)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe('描画セッション（setPixel + commitDrawing）', () => {
  it('複数の setPixel を commitDrawing で確定すると 1 件の履歴になる', () => {
    const id = createDirectLayer();
    s().setPixel(1, 2, RED);
    s().setPixel(3, 4, RED);
    s().setPixel(5, 6, BLUE);

    // 確定前は記録されない
    expect(s().history).toHaveLength(0);
    expect(s().historyIndex).toBe(-1);

    s().commitDrawing();

    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(0);
    const entry = s().history[0];
    expect(entry.pixelChanges).toHaveLength(3);
    expect(entry.pixelChanges).toEqual(
      expect.arrayContaining([
        { layerId: id, x: 1, y: 2, oldPixel: null, newPixel: RED },
        { layerId: id, x: 3, y: 4, oldPixel: null, newPixel: RED },
        { layerId: id, x: 5, y: 6, oldPixel: null, newPixel: BLUE },
      ]),
    );
    expect(entry.layerChanges).toEqual([]);
    expect(entry.layerGroupChanges).toEqual([]);
  });

  it('同じピクセルを何度塗り直しても、セッション開始前 → 最終色の 1 つの変更として記録される', () => {
    const id = createDirectLayer();
    stroke([[0, 0]], GREEN);

    s().setPixel(0, 0, RED);
    s().setPixel(0, 0, WHITE);
    s().setPixel(0, 0, BLUE);
    s().commitDrawing();

    expect(s().history).toHaveLength(2);
    expect(s().history[1].pixelChanges).toEqual([
      { layerId: id, x: 0, y: 0, oldPixel: GREEN, newPixel: BLUE },
    ]);

    // 1 回の undo で途中の色ではなくセッション開始前の色に戻る
    s().undo();
    expect(px(id, 0, 0)).toEqual(GREEN);
  });

  it('セッション内で塗ってから消し、元の状態に戻った場合は履歴に残らない', () => {
    createDirectLayer();
    s().setPixel(0, 0, RED);
    s().setPixel(0, 0, null);
    s().commitDrawing();

    expect(s().history).toHaveLength(0);
    expect(s().historyIndex).toBe(-1);
  });

  it('既に同じ色のピクセルを塗っても変化がないため履歴に残らない', () => {
    createDirectLayer();
    stroke([[0, 0], [1, 0]], RED);
    expect(s().history).toHaveLength(1);

    stroke([[0, 0], [1, 0]], { ...RED });
    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(0);
  });

  it('キャンバス範囲外への setPixel は無視され、履歴にもエンジンにも反映されない', () => {
    createDirectLayer();
    vi.clearAllMocks();

    stroke(
      [
        [-1, 0],
        [0, -1],
        [SKIN_WIDTH, 0],
        [0, SKIN_HEIGHT],
      ],
      RED,
    );

    expect(s().history).toHaveLength(0);
    expect(engine.setPixel).not.toHaveBeenCalled();
    expect(engine.erasePixel).not.toHaveBeenCalled();
  });

  it('commitDrawing で区切られた 2 回のストロークは 2 件になり、1 件ずつ戻せる', () => {
    const id = createDirectLayer();
    stroke([[0, 0], [1, 0]], RED);
    stroke([[2, 0], [3, 0]], BLUE);

    expect(s().history).toHaveLength(2);
    expect(s().historyIndex).toBe(1);

    s().undo();
    expect(px(id, 0, 0)).toEqual(RED);
    expect(px(id, 1, 0)).toEqual(RED);
    expect(px(id, 2, 0)).toBeNull();
    expect(px(id, 3, 0)).toBeNull();

    s().undo();
    expect(px(id, 0, 0)).toBeNull();
    expect(px(id, 1, 0)).toBeNull();
  });

  it('消しゴム（null）での変更も記録され、undo で消す前の色に戻る', () => {
    const id = createDirectLayer();
    stroke([[0, 0], [1, 0]], HALF_YELLOW);
    stroke([[0, 0], [1, 0]], null);

    expect(s().history).toHaveLength(2);
    expect(px(id, 0, 0)).toBeNull();

    s().undo();
    expect(px(id, 0, 0)).toEqual(HALF_YELLOW);
    expect(px(id, 1, 0)).toEqual(HALF_YELLOW);
  });

  it('ピクセル保持が有効でスキップされたピクセルは記録されない', () => {
    const id = createDirectLayer();
    stroke([[0, 0]], RED);
    s().togglePreservePixels();

    // (0,0) は既に色があるので保持され、(1,0) だけが塗られる
    stroke([[0, 0], [1, 0]], BLUE);

    expect(s().history).toHaveLength(2);
    expect(s().history[1].pixelChanges).toEqual([
      { layerId: id, x: 1, y: 0, oldPixel: null, newPixel: BLUE },
    ]);

    s().undo();
    expect(px(id, 0, 0)).toEqual(RED);
    expect(px(id, 1, 0)).toBeNull();
  });

  it('確定済みの履歴は、その後同じピクセルに描画しても書き換わらない', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    const first = structuredClone(s().history[0]);

    stroke([[0, 0]], BLUE);
    stroke([[0, 0]], null);

    expect(s().history[0]).toEqual(first);
  });
});

describe('undo', () => {
  // (0,0),(1,0) を赤で塗る → (0,0) を青で上書き・(2,0) を緑で塗る・(1,0) を消す
  function drawTwoStrokes(): string {
    const id = createDirectLayer();
    stroke([[0, 0], [1, 0]], RED);
    s().setPixel(0, 0, BLUE);
    s().setPixel(2, 0, GREEN);
    s().setPixel(1, 0, null);
    s().commitDrawing();
    return id;
  }

  it('描画セッション全体が 1 回の undo で元に戻り、historyIndex が 1 つ減る', () => {
    const id = drawTwoStrokes();
    expect(s().historyIndex).toBe(1);

    s().undo();

    expect(s().historyIndex).toBe(0);
    expect(px(id, 0, 0)).toEqual(RED);
    expect(px(id, 1, 0)).toEqual(RED);
    expect(px(id, 2, 0)).toBeNull();
  });

  it('undo はエンジンを古い値で同期する（色があれば setPixel、なければ erasePixel）', () => {
    const id = drawTwoStrokes();
    vi.clearAllMocks();

    s().undo();

    expect(engine.setPixel).toHaveBeenCalledTimes(2);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 0, 0, 255, 0, 0, 255);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 1, 0, 255, 0, 0, 255);
    expect(engine.erasePixel).toHaveBeenCalledTimes(1);
    expect(engine.erasePixel).toHaveBeenCalledWith(id, 2, 0);
    // ピクセルだけの履歴ではレイヤーの作成・削除は行わない
    expect(engine.createLayer).not.toHaveBeenCalled();
    expect(engine.deleteLayer).not.toHaveBeenCalled();
  });

  it('undo 後の合成結果（getComposite）は復元後のピクセルを反映する', () => {
    createDirectLayer();
    stroke([[4, 4]], RED);
    expect(s().getComposite()[4][4]).toEqual(RED);

    s().undo();

    expect(s().getComposite()[4][4].a).toBe(0);
  });

  it('undo は 3D プレビューの更新（previewVersion）を進める', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    const version = s().previewVersion;

    s().undo();

    expect(s().previewVersion).toBeGreaterThan(version);
  });

  it('undo を繰り返すと新しい順に戻り、historyIndex が -1 になった後は何もしない', () => {
    const id = createDirectLayer();
    stroke([[0, 0]], RED);
    stroke([[1, 0]], GREEN);
    stroke([[2, 0]], BLUE);

    s().undo();
    expect(s().historyIndex).toBe(1);
    expect(px(id, 2, 0)).toBeNull();
    expect(px(id, 1, 0)).toEqual(GREEN);

    s().undo();
    expect(s().historyIndex).toBe(0);
    expect(px(id, 1, 0)).toBeNull();
    expect(px(id, 0, 0)).toEqual(RED);

    s().undo();
    expect(s().historyIndex).toBe(-1);
    expect(px(id, 0, 0)).toBeNull();

    vi.clearAllMocks();
    expect(changesState(() => s().undo())).toBe(false);
    expect(s().historyIndex).toBe(-1);
    expect(engine.setPixel).not.toHaveBeenCalled();
    expect(engine.erasePixel).not.toHaveBeenCalled();
  });

  it('undo しても履歴エントリは削除されない（redo 用に保持される）', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    stroke([[1, 0]], RED);
    const history = s().history;

    s().undo();
    s().undo();

    expect(s().history).toBe(history);
    expect(s().history).toHaveLength(2);
  });

  it('undo は対象外のレイヤーのピクセルに影響しない', () => {
    const a = createDirectLayer('A');
    stroke([[0, 0]], RED);
    const b = createDirectLayer('B');
    stroke([[0, 0]], BLUE);

    s().undo();

    expect(px(b, 0, 0)).toBeNull();
    expect(px(a, 0, 0)).toEqual(RED);
  });

  it('存在しないレイヤーを参照するピクセル変更は undo / redo で無視される', () => {
    const id = createDirectLayer();
    setHistory([
      {
        pixelChanges: [
          { layerId: 'missing', x: 0, y: 0, oldPixel: RED, newPixel: BLUE },
          { layerId: id, x: 1, y: 0, oldPixel: GREEN, newPixel: null },
        ],
        layerChanges: [],
        layerGroupChanges: [],
      },
    ]);
    vi.clearAllMocks();

    s().undo();
    expect(s().historyIndex).toBe(-1);
    expect(px(id, 1, 0)).toEqual(GREEN);
    expect(s().layers.map((l) => l.id)).toEqual([id]);
    expect(engine.setPixel).toHaveBeenCalledTimes(1);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 1, 0, 0, 255, 0, 255);

    vi.clearAllMocks();
    s().redo();
    expect(s().historyIndex).toBe(0);
    expect(px(id, 1, 0)).toBeNull();
    expect(engine.setPixel).not.toHaveBeenCalled();
    expect(engine.erasePixel).toHaveBeenCalledTimes(1);
    expect(engine.erasePixel).toHaveBeenCalledWith(id, 1, 0);
  });
});

describe('redo', () => {
  it('undo した描画を redo で再適用し、エンジンを新しい値で同期する', () => {
    const id = createDirectLayer();
    stroke([[0, 0], [1, 0]], RED);
    s().setPixel(0, 0, BLUE);
    s().setPixel(2, 0, GREEN);
    s().setPixel(1, 0, null);
    s().commitDrawing();

    s().undo();
    s().undo();
    expect(s().historyIndex).toBe(-1);

    vi.clearAllMocks();
    s().redo();
    expect(s().historyIndex).toBe(0);
    expect(px(id, 0, 0)).toEqual(RED);
    expect(px(id, 1, 0)).toEqual(RED);
    expect(px(id, 2, 0)).toBeNull();
    expect(engine.setPixel).toHaveBeenCalledTimes(2);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 0, 0, 255, 0, 0, 255);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 1, 0, 255, 0, 0, 255);
    expect(engine.erasePixel).not.toHaveBeenCalled();

    vi.clearAllMocks();
    s().redo();
    expect(s().historyIndex).toBe(1);
    expect(px(id, 0, 0)).toEqual(BLUE);
    expect(px(id, 1, 0)).toBeNull();
    expect(px(id, 2, 0)).toEqual(GREEN);
    expect(engine.setPixel).toHaveBeenCalledTimes(2);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 0, 0, 0, 0, 255, 255);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 2, 0, 0, 255, 0, 255);
    expect(engine.erasePixel).toHaveBeenCalledTimes(1);
    expect(engine.erasePixel).toHaveBeenCalledWith(id, 1, 0);
  });

  it('最新の位置で redo しても何も起こらない', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    vi.clearAllMocks();

    expect(changesState(() => s().redo())).toBe(false);
    expect(s().historyIndex).toBe(0);
    expect(engine.setPixel).not.toHaveBeenCalled();
  });

  it('redo 後の合成結果（getComposite）は再適用後のピクセルを反映する', () => {
    createDirectLayer();
    stroke([[4, 4]], RED);
    s().undo();
    expect(s().getComposite()[4][4].a).toBe(0);

    s().redo();

    expect(s().getComposite()[4][4]).toEqual(RED);
  });

  it('全て undo してから全て redo すると、元の状態と完全に一致する', () => {
    const a = createDirectLayer('A');
    stroke([[0, 0], [1, 1], [2, 2]], RED);
    stroke([[1, 1], [3, 3]], HALF_YELLOW);
    const b = createDirectLayer('B');
    stroke([[0, 0], [63, 63]], BLUE);
    stroke([[0, 0]], null);

    const finalPixels = structuredClone(s().layers.map((l) => ({ id: l.id, pixels: l.pixels })));
    const count = s().history.length;
    expect(count).toBe(4);

    for (let i = 0; i < count; i++) s().undo();
    expect(s().historyIndex).toBe(-1);
    for (const id of [a, b]) {
      expect(getLayer(id).pixels).toEqual(emptyPixels());
    }

    for (let i = 0; i < count; i++) s().redo();
    expect(s().historyIndex).toBe(count - 1);
    expect(s().layers.map((l) => ({ id: l.id, pixels: l.pixels }))).toEqual(finalPixels);
  });
});

describe('redo スタックの切り捨て', () => {
  it('undo 後に新しい変更を確定すると、以降の履歴は破棄され redo できなくなる', () => {
    const id = createDirectLayer();
    stroke([[0, 0]], RED);
    stroke([[1, 0]], RED);
    stroke([[2, 0]], RED);
    const firstEntry = s().history[0];

    s().undo();
    s().undo();
    expect(s().historyIndex).toBe(0);

    stroke([[5, 5]], BLUE);

    expect(s().history).toHaveLength(2);
    expect(s().historyIndex).toBe(1);
    expect(s().history[0]).toBe(firstEntry);
    expect(canRedo()).toBe(false);
    expect(changesState(() => s().redo())).toBe(false);

    // 破棄された変更は戻ってこない
    expect(px(id, 1, 0)).toBeNull();
    expect(px(id, 2, 0)).toBeNull();
    expect(px(id, 5, 5)).toEqual(BLUE);

    s().undo();
    expect(px(id, 5, 5)).toBeNull();
    expect(px(id, 0, 0)).toEqual(RED);
  });

  it('全て undo した（historyIndex = -1）後に確定すると、履歴はその 1 件だけになる', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    stroke([[1, 0]], RED);
    s().undo();
    s().undo();

    stroke([[9, 9]], GREEN);

    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(0);
    expect(s().history[0].pixelChanges).toEqual([
      expect.objectContaining({ x: 9, y: 9, oldPixel: null, newPixel: GREEN }),
    ]);
  });

  it('undo 後に変更のない確定をしても redo スタックは保持される', () => {
    const id = createDirectLayer();
    stroke([[0, 0]], RED);
    s().undo();

    s().commitDrawing();
    s().saveToHistory();

    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(-1);
    s().redo();
    expect(px(id, 0, 0)).toEqual(RED);
  });
});

describe('MAX_HISTORY（履歴の上限）', () => {
  it(`上限（${MAX_HISTORY} 件）を超えると古い履歴から破棄される`, () => {
    const id = createDirectLayer();
    const extra = 5;
    const total = MAX_HISTORY + extra;
    for (let i = 0; i < total; i++) {
      stroke([[i % SKIN_WIDTH, Math.floor(i / SKIN_WIDTH)]], RED);
    }

    expect(s().history).toHaveLength(MAX_HISTORY);
    expect(s().historyIndex).toBe(MAX_HISTORY - 1);
    // 先頭は (extra) 回目のストローク
    expect(s().history[0].pixelChanges[0]).toMatchObject({ x: extra, y: 0 });

    for (let i = 0; i < MAX_HISTORY; i++) s().undo();
    expect(s().historyIndex).toBe(-1);

    // 破棄された最初の extra 回分は戻せずに残り、それ以降は全て戻っている
    for (let i = 0; i < total; i++) {
      const pixel = px(id, i % SKIN_WIDTH, Math.floor(i / SKIN_WIDTH));
      if (i < extra) {
        expect(pixel).toEqual(RED);
      } else {
        expect(pixel).toBeNull();
      }
    }

    expect(changesState(() => s().undo())).toBe(false);
  });

  it('ちょうど上限の件数までは破棄されず、全て戻せる', () => {
    const id = createDirectLayer();
    for (let i = 0; i < MAX_HISTORY; i++) stroke([[i, 0]], RED);

    expect(s().history).toHaveLength(MAX_HISTORY);
    expect(s().historyIndex).toBe(MAX_HISTORY - 1);

    for (let i = 0; i < MAX_HISTORY; i++) s().undo();
    for (let i = 0; i < MAX_HISTORY; i++) {
      expect(px(id, i, 0)).toBeNull();
    }
  });

  it('上限に達した状態で undo してから確定すると、切り捨て後に追加されるため破棄は起きない', () => {
    const id = createDirectLayer();
    for (let i = 0; i < MAX_HISTORY; i++) stroke([[i, 0]], RED);
    const firstEntry = s().history[0];

    s().undo();
    stroke([[0, 1]], BLUE);

    expect(s().history).toHaveLength(MAX_HISTORY);
    expect(s().historyIndex).toBe(MAX_HISTORY - 1);
    expect(s().history[0]).toBe(firstEntry);

    // 最初のストロークまで含めて全て戻せる
    for (let i = 0; i < MAX_HISTORY; i++) s().undo();
    expect(px(id, 0, 0)).toBeNull();
    expect(px(id, 0, 1)).toBeNull();
  });
});

describe('setPixelRect（矩形塗り）', () => {
  it('commitDrawing を待たずに 1 件として記録され、undo で矩形全体が元に戻る', () => {
    const id = createDirectLayer();
    stroke([[1, 1]], RED);

    s().setPixelRect(0, 0, 2, 2, BLUE);

    expect(s().history).toHaveLength(2);
    expect(s().history[1].pixelChanges).toHaveLength(9);

    vi.clearAllMocks();
    s().undo();

    for (let y = 0; y <= 2; y++) {
      for (let x = 0; x <= 2; x++) {
        expect(px(id, x, y)).toEqual(x === 1 && y === 1 ? RED : null);
      }
    }
    expect(engine.setPixel).toHaveBeenCalledTimes(1);
    expect(engine.setPixel).toHaveBeenCalledWith(id, 1, 1, 255, 0, 0, 255);
    expect(engine.erasePixel).toHaveBeenCalledTimes(8);
  });

  it('矩形塗りの直後の commitDrawing では履歴が重複しない', () => {
    createDirectLayer();
    s().setPixelRect(0, 0, 3, 3, RED);
    s().commitDrawing();

    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(0);
  });

  it('矩形消しゴムも 1 件として記録され、undo で消す前の色に戻る', () => {
    const id = createDirectLayer();
    s().setPixelRect(0, 0, 1, 1, GREEN);
    s().setPixelRect(0, 0, 1, 1, null);

    expect(s().history).toHaveLength(2);
    expect(px(id, 0, 0)).toBeNull();

    s().undo();
    expect(px(id, 0, 0)).toEqual(GREEN);
    expect(px(id, 1, 1)).toEqual(GREEN);
  });
});

describe('レイヤー基本色の変更（updateLayerColor + saveToHistory）', () => {
  // 単色レイヤーを作り、3 ピクセル塗って確定する（単色レイヤーでは基本色で塗られる）
  function setupSingleColorLayer(): string {
    const id = s().createLayer('単色', RED, 'singleColor');
    stroke([[0, 0], [1, 0], [2, 0]], GREEN);
    return id;
  }

  const drawn: [number, number][] = [[0, 0], [1, 0], [2, 0]];

  it('色変更後の saveToHistory でちょうど 1 件記録され、undo で基本色とピクセルの両方が戻る', () => {
    const id = setupSingleColorLayer();
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(RED);
    expect(s().history).toHaveLength(1);

    s().updateLayerColor(id, BLUE);
    // saveToHistory までは記録されない
    expect(s().history).toHaveLength(1);

    s().saveToHistory();
    expect(s().history).toHaveLength(2);
    expect(s().historyIndex).toBe(1);
    expect(getLayer(id).baseColor).toEqual(BLUE);
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(BLUE);

    s().undo();
    expect(s().historyIndex).toBe(0);
    expect(getLayer(id).baseColor).toEqual(RED);
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(RED);
    // 塗られていないピクセルは透明のまま
    expect(px(id, 3, 0)).toBeNull();
  });

  it('色変更の undo でエンジンのピクセルも元の色に同期される', () => {
    const id = setupSingleColorLayer();
    s().updateLayerColor(id, BLUE);
    s().saveToHistory();
    vi.clearAllMocks();

    s().undo();

    expect(engine.setPixel).toHaveBeenCalledTimes(drawn.length);
    for (const [x, y] of drawn) {
      expect(engine.setPixel).toHaveBeenCalledWith(id, x, y, 255, 0, 0, 255);
    }
    expect(engine.erasePixel).not.toHaveBeenCalled();
  });

  it('色変更を redo すると基本色とピクセルが再び変更後の色になる', () => {
    const id = setupSingleColorLayer();
    s().updateLayerColor(id, BLUE);
    s().saveToHistory();
    s().undo();
    vi.clearAllMocks();

    s().redo();

    expect(s().historyIndex).toBe(1);
    expect(getLayer(id).baseColor).toEqual(BLUE);
    for (const [x, y] of drawn) {
      expect(px(id, x, y)).toEqual(BLUE);
      expect(engine.setPixel).toHaveBeenCalledWith(id, x, y, 0, 0, 255, 255);
    }
  });

  it('ドラッグ中の複数回の updateLayerColor は 1 回の saveToHistory で 1 件になり、undo でドラッグ前の色に戻る', () => {
    const id = setupSingleColorLayer();

    s().updateLayerColor(id, { r: 200, g: 10, b: 10, a: 255 });
    s().updateLayerColor(id, { r: 100, g: 50, b: 60, a: 255 });
    s().updateLayerColor(id, BLUE);
    s().saveToHistory();

    expect(s().history).toHaveLength(2);
    expect(getLayer(id).baseColor).toEqual(BLUE);

    s().undo();
    expect(getLayer(id).baseColor).toEqual(RED);
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(RED);

    s().redo();
    expect(getLayer(id).baseColor).toEqual(BLUE);
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(BLUE);
  });

  it('同じ色への変更は変化がないため履歴に残らない', () => {
    const id = setupSingleColorLayer();

    s().updateLayerColor(id, { ...RED });
    s().saveToHistory();

    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(0);
  });

  it('ドラッグで色を変えてから元の色に戻した場合も履歴に残らない', () => {
    const id = setupSingleColorLayer();

    s().updateLayerColor(id, BLUE);
    s().updateLayerColor(id, { ...RED });
    s().saveToHistory();

    expect(s().history).toHaveLength(1);
  });

  it('direct レイヤーの色変更はピクセルを変えず、undo で基本色だけが戻る', () => {
    const id = s().createLayer('直接', RED, 'direct');
    stroke([[0, 0]], GREEN);

    s().updateLayerColor(id, BLUE);
    s().saveToHistory();

    expect(s().history).toHaveLength(2);
    expect(s().history[1].pixelChanges).toEqual([]);
    expect(px(id, 0, 0)).toEqual(GREEN);

    s().undo();
    expect(getLayer(id).baseColor).toEqual(RED);
    expect(px(id, 0, 0)).toEqual(GREEN);

    s().redo();
    expect(getLayer(id).baseColor).toEqual(BLUE);
    expect(px(id, 0, 0)).toEqual(GREEN);
  });

  it('色変更の undo は他のレイヤーに影響しない', () => {
    const other = s().createLayer('別', GREEN, 'singleColor');
    stroke([[5, 5]], GREEN);
    const id = setupSingleColorLayer();

    s().updateLayerColor(id, BLUE);
    s().saveToHistory();
    s().undo();

    expect(getLayer(other).baseColor).toEqual(GREEN);
    expect(px(other, 5, 5)).toEqual(GREEN);
  });

  it('存在しないレイヤーへの updateLayerColor は何も記録しない', () => {
    setupSingleColorLayer();

    s().updateLayerColor('missing', BLUE);
    s().saveToHistory();

    expect(s().history).toHaveLength(1);
  });

  it('色変更の確定は undo 済みの履歴（redo スタック）を切り捨てる', () => {
    const id = setupSingleColorLayer();
    s().undo();
    expect(canRedo()).toBe(true);

    s().updateLayerColor(id, BLUE);
    s().saveToHistory();

    expect(s().history).toHaveLength(1);
    expect(s().historyIndex).toBe(0);
    expect(canRedo()).toBe(false);

    s().undo();
    expect(getLayer(id).baseColor).toEqual(RED);
  });

  it('キャンバスから基本色を取得（applyPickedColor）すると 1 件記録され、undo で戻る', () => {
    const id = setupSingleColorLayer();
    s().startLayerColorPick(id);

    s().applyPickedColor(BLUE);

    expect(s().history).toHaveLength(2);
    expect(getLayer(id).baseColor).toEqual(BLUE);
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(BLUE);

    s().undo();
    expect(getLayer(id).baseColor).toEqual(RED);
    for (const [x, y] of drawn) expect(px(id, x, y)).toEqual(RED);
  });
});

describe('saveToHistory', () => {
  it('変更の途中でない（スナップショットがない）ときは何も記録しない', () => {
    createDirectLayer();

    expect(changesState(() => s().saveToHistory())).toBe(false);
    expect(s().history).toHaveLength(0);
    expect(s().historyIndex).toBe(-1);
  });

  it('確定直後にもう一度呼んでも記録は増えない', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    const history = s().history;

    s().saveToHistory();
    s().saveToHistory();

    expect(s().history).toBe(history);
    expect(s().historyIndex).toBe(0);
  });
});

describe('レイヤー・グループの変更の undo / redo', () => {
  it('レイヤー追加（add）の undo でレイヤーが削除され、redo で画素ごと復元される', () => {
    const a = makeLayer({ id: 'layer-a', order: 0 });
    const bPixels = emptyPixels();
    bPixels[5][5] = { ...RED };
    const b = makeLayer({ id: 'layer-b', name: 'B', order: 1, pixels: bPixels });
    useEditorStore.setState({ layers: [a, b] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [{ type: 'add', layerId: b.id, newLayer: structuredClone(b) }],
        layerGroupChanges: [],
      },
    ]);

    s().undo();
    expect(s().layers.map((l) => l.id)).toEqual([a.id]);
    expect(engine.deleteLayer).toHaveBeenCalledWith(b.id);
    expect(s().historyIndex).toBe(-1);

    vi.clearAllMocks();
    s().redo();
    expect(s().historyIndex).toBe(0);
    expect(s().layers.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
    expect(getLayer(b.id)).toEqual(b);

    expect(engine.createLayer).toHaveBeenCalledWith(b.id, 1);
    expect(engine.setLayerData).toHaveBeenCalledTimes(1);
    const [layerId, order, data] = engine.setLayerData.mock.calls[0] as [string, number, Uint8ClampedArray];
    expect(layerId).toBe(b.id);
    expect(order).toBe(1);
    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data.length).toBe(SKIN_WIDTH * SKIN_HEIGHT * 4);
    const i = (5 * SKIN_WIDTH + 5) * 4;
    expect(Array.from(data.slice(i, i + 4))).toEqual([255, 0, 0, 255]);
    // それ以外は透明
    expect(data.reduce((sum, v) => sum + v, 0)).toBe(255 + 255);
  });

  it('レイヤー削除（remove）の undo で削除前のレイヤー（設定と画素）が復元され、redo で再び削除される', () => {
    const keep = makeLayer({ id: 'keep', order: 0 });
    const removedPixels = emptyPixels();
    removedPixels[1][2] = { ...HALF_YELLOW };
    const removed = makeLayer({
      id: 'removed',
      name: '削除されたレイヤー',
      order: 2,
      groupId: 'g1',
      visible: false,
      opacity: 40,
      layerType: 'singleColor',
      baseColor: { ...HALF_YELLOW },
      pixels: removedPixels,
    });
    useEditorStore.setState({ layers: [keep], layerGroups: [makeGroup({ id: 'g1' })] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [{ type: 'remove', layerId: removed.id, oldLayer: structuredClone(removed) }],
        layerGroupChanges: [],
      },
    ]);

    s().undo();
    expect(getLayer(removed.id)).toEqual(removed);
    expect(getLayer(keep.id)).toEqual(keep);
    expect(engine.createLayer).toHaveBeenCalledWith(removed.id, 2);
    expect(engine.setLayerData).toHaveBeenCalledWith(removed.id, 2, expect.any(Uint8ClampedArray));
    const data = engine.setLayerData.mock.calls[0][2] as Uint8ClampedArray;
    const i = (1 * SKIN_WIDTH + 2) * 4;
    expect(Array.from(data.slice(i, i + 4))).toEqual([250, 240, 10, 128]);

    vi.clearAllMocks();
    s().redo();
    expect(s().layers.map((l) => l.id)).toEqual([keep.id]);
    expect(engine.deleteLayer).toHaveBeenCalledWith(removed.id);
  });

  it('レイヤー更新（update）の undo / redo は設定だけを切り替え、ピクセルは現在のものを保持する', () => {
    const pixels = emptyPixels();
    pixels[0][0] = { ...BLUE };
    const current = makeLayer({
      id: 'l1',
      name: '新しい名前',
      order: 3,
      groupId: 'g1',
      visible: false,
      opacity: 50,
      baseColor: { ...BLUE },
      pixels,
    });
    const oldMeta = makeLayer({
      id: 'l1',
      name: '古い名前',
      order: 1,
      groupId: null,
      visible: true,
      opacity: 100,
      baseColor: { ...RED },
      pixels: [],
    });
    useEditorStore.setState({ layers: [current], layerGroups: [makeGroup({ id: 'g1' })] });
    // 実際の履歴と同様に、更新のエントリは画素を持たない（pixels: []）
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [
          { type: 'update', layerId: 'l1', oldLayer: oldMeta, newLayer: { ...current, pixels: [] } },
        ],
        layerGroupChanges: [],
      },
    ]);

    s().undo();
    expect(getLayer('l1')).toMatchObject({
      name: '古い名前',
      order: 1,
      groupId: null,
      visible: true,
      opacity: 100,
      baseColor: RED,
    });
    expect(px('l1', 0, 0)).toEqual(BLUE);
    expect(getLayer('l1').pixels).toHaveLength(SKIN_HEIGHT);
    expect(engine.setLayerOrder).toHaveBeenCalledWith('l1', 1);

    vi.clearAllMocks();
    s().redo();
    expect(getLayer('l1')).toMatchObject({
      name: '新しい名前',
      order: 3,
      groupId: 'g1',
      visible: false,
      opacity: 50,
      baseColor: BLUE,
    });
    expect(px('l1', 0, 0)).toEqual(BLUE);
    expect(engine.setLayerOrder).toHaveBeenCalledWith('l1', 3);
  });

  it('グループ追加の undo でグループが削除され、redo で再追加される', () => {
    const existing = makeGroup({ id: 'g-old', name: '既存', order: 0 });
    const added = makeGroup({ id: 'g-new', name: '新規', order: 1 });
    useEditorStore.setState({ layerGroups: [existing, added] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [],
        layerGroupChanges: [{ type: 'add', groupId: added.id, newGroup: { ...added } }],
      },
    ]);

    s().undo();
    expect(s().layerGroups).toEqual([existing]);

    s().redo();
    expect(s().layerGroups).toEqual([existing, added]);
  });

  it('グループ削除の undo でグループが復元され、redo で再び削除される', () => {
    const existing = makeGroup({ id: 'g-old', name: '既存', order: 0 });
    const removed = makeGroup({ id: 'g-removed', name: '削除', order: 1, collapsed: true, visible: false });
    useEditorStore.setState({ layerGroups: [existing] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [],
        layerGroupChanges: [{ type: 'remove', groupId: removed.id, oldGroup: { ...removed } }],
      },
    ]);

    s().undo();
    expect(s().layerGroups).toHaveLength(2);
    expect(s().layerGroups).toEqual(expect.arrayContaining([existing, removed]));

    s().redo();
    expect(s().layerGroups).toEqual([existing]);
  });

  it('グループ更新の undo で変更前の設定に、redo で変更後の設定に戻る', () => {
    const before = makeGroup({ id: 'g1', name: '変更前', collapsed: false, visible: true, order: 0 });
    const after = makeGroup({ id: 'g1', name: '変更後', collapsed: true, visible: false, order: 4 });
    const other = makeGroup({ id: 'g2', name: '別', order: 1 });
    useEditorStore.setState({ layerGroups: [after, other] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [],
        layerGroupChanges: [{ type: 'update', groupId: 'g1', oldGroup: { ...before }, newGroup: { ...after } }],
      },
    ]);

    s().undo();
    expect(s().layerGroups).toEqual([before, other]);

    s().redo();
    expect(s().layerGroups).toEqual([after, other]);
  });

  it('1 件の履歴にピクセル・レイヤー・グループの変更が混在していても、1 回の undo / redo でまとめて切り替わる', () => {
    const pixels = emptyPixels();
    pixels[0][0] = { ...BLUE };
    const layer = makeLayer({ id: 'l1', name: '後', order: 0, pixels });
    const addedLayer = makeLayer({ id: 'l2', order: 1 });
    const group = makeGroup({ id: 'g1' });
    useEditorStore.setState({ layers: [layer, addedLayer], layerGroups: [group] });
    setHistory([
      {
        pixelChanges: [{ layerId: 'l1', x: 0, y: 0, oldPixel: { ...RED }, newPixel: { ...BLUE } }],
        layerChanges: [
          { type: 'update', layerId: 'l1', oldLayer: { ...layer, name: '前', pixels: [] }, newLayer: { ...layer, pixels: [] } },
          { type: 'add', layerId: 'l2', newLayer: structuredClone(addedLayer) },
        ],
        layerGroupChanges: [{ type: 'add', groupId: 'g1', newGroup: { ...group } }],
      },
    ]);

    s().undo();
    expect(s().historyIndex).toBe(-1);
    expect(s().layers.map((l) => l.id)).toEqual(['l1']);
    expect(getLayer('l1').name).toBe('前');
    expect(px('l1', 0, 0)).toEqual(RED);
    expect(s().layerGroups).toEqual([]);

    s().redo();
    expect(s().historyIndex).toBe(0);
    expect(s().layers.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
    expect(getLayer('l1').name).toBe('後');
    expect(px('l1', 0, 0)).toEqual(BLUE);
    expect(s().layerGroups).toEqual([group]);
  });

  it('redo で復元したレイヤーに描画しても、履歴エントリの内容は書き換わらない', () => {
    const bPixels = emptyPixels();
    bPixels[5][5] = { ...RED };
    const b = makeLayer({ id: 'layer-b', order: 0, pixels: bPixels });
    useEditorStore.setState({ layers: [b] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [{ type: 'add', layerId: b.id, newLayer: structuredClone(b) }],
        layerGroupChanges: [],
      },
    ]);
    s().undo();
    s().redo();

    s().setActiveLayer(b.id);
    stroke([[5, 5], [6, 6]], GREEN);

    const addEntry = s().history[0].layerChanges[0];
    expect(addEntry.newLayer!.pixels[5][5]).toEqual(RED);
    expect(addEntry.newLayer!.pixels[6][6]).toBeNull();

    // 描画を戻し、追加も戻してからやり直すと、追加時の画素で復元される
    s().undo();
    s().undo();
    s().redo();
    expect(px(b.id, 5, 5)).toEqual(RED);
    expect(px(b.id, 6, 6)).toBeNull();
  });

  it('undo で復元した削除済みレイヤーに描画しても、履歴エントリの内容は書き換わらない', () => {
    const removedPixels = emptyPixels();
    removedPixels[0][0] = { ...RED };
    const removed = makeLayer({ id: 'removed', order: 0, pixels: removedPixels });
    useEditorStore.setState({ layers: [] });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [{ type: 'remove', layerId: removed.id, oldLayer: structuredClone(removed) }],
        layerGroupChanges: [],
      },
    ]);
    s().undo();

    // 復元したレイヤーの画素配列を直接書き換えても（setPixel は配列を直接更新する）履歴には波及しない
    s().setActiveLayer(removed.id);
    s().setPixel(0, 0, BLUE);
    s().setPixel(1, 1, BLUE);

    const entry = s().history[0].layerChanges[0];
    expect(entry.oldLayer!.pixels[0][0]).toEqual(RED);
    expect(entry.oldLayer!.pixels[1][1]).toBeNull();
    s().commitDrawing();
  });
});

describe('ツールバーの canUndo / canRedo 判定との整合', () => {
  it('履歴が 1 件（historyIndex = 0）でも undo できる', () => {
    const id = createDirectLayer();
    stroke([[0, 0]], RED);

    expect(s().historyIndex).toBe(0);
    expect(canUndo()).toBe(true);
    expect(changesState(() => s().undo())).toBe(true);
    expect(px(id, 0, 0)).toBeNull();
  });

  it('canUndo / canRedo が真のときに限り undo / redo で状態が変わる', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    stroke([[1, 0]], RED);
    stroke([[2, 0]], RED);

    // 末尾から先頭まで戻る
    const undoResults: [boolean, boolean][] = [];
    for (let i = 0; i < 4; i++) {
      const expected = canUndo();
      undoResults.push([expected, changesState(() => s().undo())]);
    }
    expect(undoResults).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [false, false],
    ]);

    // 先頭から末尾まで進む
    const redoResults: [boolean, boolean][] = [];
    for (let i = 0; i < 4; i++) {
      const expected = canRedo();
      redoResults.push([expected, changesState(() => s().redo())]);
    }
    expect(redoResults).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [false, false],
    ]);
  });

  it('historyIndex は常に -1 以上、履歴の件数 - 1 以下に収まる', () => {
    createDirectLayer();
    const check = () => {
      expect(s().historyIndex).toBeGreaterThanOrEqual(-1);
      expect(s().historyIndex).toBeLessThanOrEqual(s().history.length - 1);
    };
    const ops = [
      () => stroke([[0, 0]], RED),
      () => s().undo(),
      () => s().undo(),
      () => s().redo(),
      () => s().redo(),
      () => stroke([[1, 0]], RED),
      () => stroke([[2, 0]], RED),
      () => s().undo(),
      () => stroke([[3, 0]], RED),
      () => s().redo(),
      () => s().undo(),
      () => s().undo(),
      () => s().undo(),
      () => s().undo(),
    ];
    for (const op of ops) {
      op();
      check();
    }
  });
});

describe('reset', () => {
  it('reset で履歴が消え、undo / redo はできなくなる', () => {
    createDirectLayer();
    stroke([[0, 0]], RED);
    stroke([[1, 0]], RED);
    s().undo();

    s().reset();

    expect(s().history).toEqual([]);
    expect(s().historyIndex).toBe(-1);
    expect(changesState(() => s().undo())).toBe(false);
    expect(changesState(() => s().redo())).toBe(false);
  });
});

// ================================================================
// レイヤー構造を変える操作（複製・統合・分割・境界ブレンド・自動生成・画像読み込み）
// ================================================================
describe('レイヤー構造を変える操作の undo / redo', () => {
  // node 環境には ImageData が無いので、ストアが使う最小限の実装を用意する
  class TestImageData {
    readonly data: Uint8ClampedArray;
    constructor(readonly width: number, readonly height: number) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  }
  const globals = globalThis as unknown as { ImageData?: unknown };
  let originalImageData: unknown;
  beforeAll(() => {
    originalImageData = globals.ImageData;
    if (typeof globals.ImageData === 'undefined') globals.ImageData = TestImageData;
  });
  afterAll(() => {
    globals.ImageData = originalImageData;
  });

  // 比較用: レイヤー・グループを ID 順に並べて値だけにする（配列の並び順の違いは無視）
  function projectState() {
    const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
    return JSON.parse(JSON.stringify({ layers: byId(s().layers), layerGroups: byId(s().layerGroups) }));
  }

  function compositeState() {
    return JSON.parse(JSON.stringify(s().getComposite()));
  }

  // 2 つのレイヤー（片方はグループ内）に描いて、1 件の履歴（ストローク）がある状態を作る
  function setup() {
    const groupId = s().createLayerGroup('グループ');
    const a = createDirectLayer('A');
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) s().setPixel(x, y, RED);
    s().setPixel(9, 9, GREEN);
    s().commitDrawing();
    const b = createDirectLayer('B');
    s().moveLayerToGroup(b, groupId);
    stroke([[12, 8], [12, 9], [13, 8], [13, 9]], BLUE);
    return { a, b, groupId };
  }

  function imageDataFrom(paint: Array<[number, number, RGBA]>) {
    const image = new TestImageData(SKIN_WIDTH, SKIN_HEIGHT);
    for (const [x, y, c] of paint) {
      const i = (y * SKIN_WIDTH + x) * 4;
      image.data.set([c.r, c.g, c.b, c.a], i);
    }
    return image as unknown as ImageData;
  }

  const ACTIONS: Array<[string, (ids: { a: string; b: string }) => void]> = [
    ['duplicateLayer（複製）', ({ a }) => { s().duplicateLayer(a); }],
    ['mergeLayersById（統合）', ({ a, b }) => { s().mergeLayersById(b, a); }],
    ['mergeSimilarLayersAction（似た色の統合）', () => { s().mergeSimilarLayersAction({ thresholdValue: 441, applyNoise: false }); }],
    ['splitLayerByColorAction（色で分割）', ({ a }) => { s().splitLayerByColorAction(a, { applyNoise: false }); }],
    ['splitLayerBySelectionAction（選択範囲で分割）', ({ a }) => { s().splitLayerBySelectionAction(a, [{ x: 8, y: 8 }, { x: 9, y: 8 }]); }],
    ['blendBordersAction（境界ブレンド）', () => { s().blendBordersAction(50); }],
    ['generateLayers（レイヤー自動生成）', () => { s().generateLayers({ applyNoise: false }); }],
    ['loadFromImageData（画像の読み込み）', () => { s().loadFromImageData(imageDataFrom([[0, 0, GREEN], [1, 0, BLUE]])); }],
  ];

  it.each(ACTIONS)('%s は 1 件の履歴になり、undo で操作前に、redo で操作後に戻る', (_name, action) => {
    const ids = setup();
    expect(s().history).toHaveLength(2);
    const before = projectState();
    const beforeComposite = compositeState();

    action(ids);
    const after = projectState();
    const afterComposite = compositeState();
    expect(after).not.toEqual(before); // 前提: 操作で内容が変わる
    expect(s().history).toHaveLength(3);
    expect(s().historyIndex).toBe(2);

    s().undo();
    expect(projectState()).toEqual(before);
    expect(compositeState()).toEqual(beforeComposite);
    expect(s().historyIndex).toBe(1);

    s().redo();
    expect(projectState()).toEqual(after);
    expect(compositeState()).toEqual(afterComposite);
    expect(s().historyIndex).toBe(2);
  });

  it.each(ACTIONS)('%s の後の undo で、その前の無関係なストロークは戻らない', (_name, action) => {
    const ids = setup();
    action(ids);
    s().undo();
    // 直前のストローク（B の青）は残っている
    expect(projectState().layers.find((l: Layer) => l.id === ids.b).pixels[8][12]).toEqual(BLUE);
  });

  it('選択範囲で分割して何も分割されなかった場合は、履歴を追加せず次のストロークにも混ざらない', () => {
    const { a } = setup();
    expect(s().splitLayerBySelectionAction(a, [])).toBeNull();
    expect(s().history).toHaveLength(2);

    // 履歴に残らない変更（名前変更）をしてから描く
    s().updateLayerName(a, '新しい名前');
    s().setActiveLayer(a);
    stroke([[20, 20]], BLUE);
    expect(s().history).toHaveLength(3);

    // 次のストロークの undo は、そのストロークだけを戻す（分割時のスナップショットが残っていると名前も戻る）
    s().undo();
    expect(px(a, 20, 20)).toBeNull();
    expect(px(a, 8, 8)).toEqual(RED);
    expect(getLayer(a).name).toBe('新しい名前');
  });
});

// ================================================================
// 更新の undo / redo は、その履歴で変わった項目だけを戻す
// ================================================================
describe('更新の undo / redo と、履歴に記録されない変更', () => {
  it('基本色の変更を undo / redo しても、その後の名前・不透明度・表示・グループの変更は巻き戻らない', () => {
    const id = s().createLayer('元の名前', RED, 'singleColor');
    stroke([[8, 8]], RED);
    s().updateLayerColor(id, BLUE);
    s().saveToHistory();

    // 履歴に記録されない変更
    const group = s().createLayerGroup('グループ');
    s().updateLayerName(id, '新しい名前');
    s().updateLayerOpacity(id, 40);
    s().toggleLayerVisibility(id);
    s().moveLayerToGroup(id, group);
    const moved = getLayer(id);

    s().undo();
    expect(getLayer(id).baseColor).toEqual(RED);
    expect(px(id, 8, 8)).toEqual(RED);
    expect(getLayer(id)).toMatchObject({
      name: '新しい名前',
      opacity: 40,
      visible: false,
      groupId: group,
      order: moved.order,
    });

    s().redo();
    expect(getLayer(id).baseColor).toEqual(BLUE);
    expect(px(id, 8, 8)).toEqual(BLUE);
    expect(getLayer(id)).toMatchObject({
      name: '新しい名前',
      opacity: 40,
      visible: false,
      groupId: group,
      order: moved.order,
    });
  });

  it('グループの更新を undo / redo しても、その履歴で変わっていない項目は現在の値のまま', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup({ id: 'g', name: '現在の名前', collapsed: true, visible: false, order: 0 })],
    });
    setHistory([
      {
        pixelChanges: [],
        layerChanges: [],
        layerGroupChanges: [
          {
            type: 'update',
            groupId: 'g',
            oldGroup: makeGroup({ id: 'g', name: '記録時の名前', collapsed: false, visible: true, order: 0 }),
            newGroup: makeGroup({ id: 'g', name: '記録時の名前', collapsed: true, visible: true, order: 0 }),
          },
        ],
      },
    ]);

    s().undo();
    expect(s().layerGroups[0]).toMatchObject({ name: '現在の名前', collapsed: false, visible: false });

    s().redo();
    expect(s().layerGroups[0]).toMatchObject({ name: '現在の名前', collapsed: true, visible: false });
  });
});

// ================================================================
// プロジェクトを開く（JSON 読み込み）と履歴
// ================================================================
describe('loadProject（プロジェクトを開く）', () => {
  it('前のプロジェクトの履歴を消し、元に戻しても前のプロジェクトのレイヤーやグループが入り込まない', () => {
    // 前のプロジェクト: グループ付きのレイヤーを作り、構造を変える操作を履歴に残す
    const group = s().createLayerGroup('前のグループ');
    const a = createDirectLayer('前のA');
    stroke([[1, 1]], RED);
    s().moveLayerToGroup(a, group);
    s().duplicateLayer(a);
    expect(s().history.length).toBeGreaterThan(0);

    const imported = makeLayer({ id: 'imported', name: '読み込んだレイヤー' });
    imported.pixels[5][5] = { ...BLUE };
    s().loadProject({ layers: [imported], layerGroups: [], palette: [] });

    expect(s().history).toEqual([]);
    expect(s().historyIndex).toBe(-1);
    s().undo();
    expect(s().layers.map((l) => l.id)).toEqual(['imported']);
    expect(s().layerGroups).toEqual([]);
  });

  it('読み込んだレイヤーを選択状態にし、PixelEngine も作り直す', () => {
    createDirectLayer('前');
    const imported = makeLayer({ id: 'imported', order: 3 });
    imported.pixels[0][0] = { ...GREEN };
    vi.clearAllMocks();

    s().loadProject({ layers: [imported], layerGroups: [makeGroup({ id: 'g' })], palette: [] });

    expect(s().activeLayerId).toBe('imported');
    expect(engine.clearAllLayers).toHaveBeenCalledTimes(1);
    expect(engine.createLayer).toHaveBeenCalledWith('imported', 3);
    expect(engine.setLayerData).toHaveBeenCalledWith('imported', 3, expect.any(Uint8ClampedArray));
    expect(s().getComposite()[0][0]).toEqual(GREEN);
  });

  it('描きかけのストロークの元に戻す情報も持ち越さない', () => {
    createDirectLayer('前');
    s().setPixel(2, 2, RED); // commitDrawing していない（スナップショットが残っている）

    const imported = makeLayer({ id: 'imported' });
    s().loadProject({ layers: [imported], layerGroups: [], palette: [] });
    s().setActiveLayer('imported');
    stroke([[3, 3]], BLUE);

    // 記録されるのは読み込み後のストロークだけ
    expect(s().history).toHaveLength(1);
    s().undo();
    expect(s().layers.map((l) => l.id)).toEqual(['imported']);
    expect(px('imported', 3, 3)).toBeNull();
  });
});

// ================================================================
// 元に戻す・やり直しで、削除済みのグループに属するレイヤーが戻る場合
// ================================================================
describe('削除したグループと undo / redo', () => {
  it('グループを削除した後に、そのグループのレイヤーを元に戻すと、グループなしのレイヤーとして戻る', () => {
    const group = s().createLayerGroup('G');
    const a = createDirectLayer('A');
    stroke([[1, 1]], RED);
    const b = createDirectLayer('B');
    stroke([[2, 2]], BLUE);
    s().moveLayerToGroup(b, group);
    // B を A に統合（B はグループ G から消える）→ 空になった G を削除（履歴に残らない）
    s().mergeLayersById(b, a);
    s().deleteLayerGroup(group);

    s().undo();

    expect(getLayer(b).groupId).toBeNull();
    expect(s().layerGroups.some((g) => g.id === group)).toBe(false);
  });

  it('グループを削除した後のやり直しで追加されるレイヤーも、グループなしになる', () => {
    const group = s().createLayerGroup('G');
    const a = createDirectLayer('A');
    stroke([[1, 1], [2, 1]], RED);
    s().moveLayerToGroup(a, group);
    // 選択範囲で分割（新しいレイヤーは元のグループ G に入る）→ 取り消す
    const split = s().splitLayerBySelectionAction(a, [{ x: 1, y: 1 }])!;
    s().undo();
    // グループを削除（履歴に残らない）
    s().deleteLayerGroup(group);

    s().redo(); // 分割をやり直す

    expect(getLayer(split).groupId).toBeNull();
  });
});

// ================================================================
// 元に戻す・やり直しと選択中のレイヤー
// ================================================================
describe('undo / redo と選択中のレイヤー', () => {
  it('複製を元に戻すと元のレイヤーが選択に戻り、次に描く線は元のレイヤーに入る', () => {
    const a = createDirectLayer('A');
    stroke([[1, 1]], RED);
    s().duplicateLayer(a);
    const copy = s().activeLayerId;
    expect(copy).not.toBe(a);

    s().undo();
    expect(s().activeLayerId).toBe(a);

    const layerCount = s().layers.length;
    stroke([[4, 4]], BLUE);
    expect(s().layers).toHaveLength(layerCount); // 新しいレイヤーは作られない
    expect(px(a, 4, 4)).toEqual(BLUE);

    // やり直しの前に、描いた線を取り消しておく
    s().undo();
    s().redo(); // 線をやり直す（選択は A のまま）
    expect(s().activeLayerId).toBe(a);
  });

  it('やり直しでは操作後に選択されていたレイヤーが選択に戻る', () => {
    const a = createDirectLayer('A');
    stroke([[1, 1]], RED);
    s().duplicateLayer(a);
    const copy = s().activeLayerId;
    s().undo();

    s().redo();

    expect(s().activeLayerId).toBe(copy);
  });

  it.each([
    ['選択範囲で分割', (a: string) => { s().splitLayerBySelectionAction(a, [{ x: 1, y: 1 }]); }],
    ['レイヤー自動生成', () => { s().generateLayers({ applyNoise: false }); }],
  ])('%s を元に戻すと、操作前に選択していたレイヤーが選択に戻る', (_name, action) => {
    const globals = globalThis as unknown as { ImageData?: unknown };
    const original = globals.ImageData;
    globals.ImageData ??= class {
      readonly data: Uint8ClampedArray;
      constructor(readonly width: number, readonly height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
    try {
      const a = createDirectLayer('A');
      stroke([[1, 1], [2, 1]], RED);
      action(a);
      expect(s().activeLayerId).not.toBe(a);

      s().undo();

      expect(s().activeLayerId).toBe(a);
    } finally {
      globals.ImageData = original;
    }
  });
});
