// @vitest-environment jsdom
// エディタストアの永続化（IndexedDB）のテスト
//
// - ストアはモジュールのシングルトンで、読み込み（hydration）はモジュール評価時に始まる。
//   テストごとに新しい IndexedDB（IDBFactory）を用意し、vi.resetModules() の後にストアを
//   動的 import することで「ページの（再）読み込み」を再現する
// - 書き込み回数は IDBObjectStore.prototype.put の呼び出し回数で数える
//   （テスト側の書き込みは add を使うので数に入らない）
// - タイマーは setTimeout / clearTimeout / performance だけを偽物にする。
//   fake-indexeddb は setImmediate で動くため、IndexedDB の処理は実時間で進む
import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  type CanvasBackground,
  type Layer,
  type LayerGroup,
  type LayerPixels,
  type ModelType,
  type PaletteColor,
  type RGBA,
  DEFAULT_CANVAS_BACKGROUND,
  SKIN_HEIGHT,
  SKIN_WIDTH,
} from '../types/editor';

// Web Worker を起動しないよう PixelEngine をモックに差し替える
vi.mock('../lib/pixelEngine', () => import('../test/pixelEngineMock'));

type EditorStore = (typeof import('./editorStore'))['useEditorStore'];
type EngineMock = (typeof import('../test/pixelEngineMock'))['engine'];

// 保存先（既存ユーザーのデータの置き場所なので、変わると保存済みプロジェクトが読めなくなる）
const DB_NAME = 'skin-crafter';
const OBJECT_STORE = 'store';
const PROJECT_KEY = 'skin-crafter-project';

// 書き込みの間引き
const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

// 永続化対象のフィールド
interface PersistedFields {
  layers: Layer[];
  layerGroups: LayerGroup[];
  palette: PaletteColor[];
  modelType: ModelType;
  showLayer2: boolean;
  preservePixels: boolean;
  canvasBackground: CanvasBackground;
}

interface SavedProject {
  state: PersistedFields;
  version: number;
}

function persistedFields(state: PersistedFields): PersistedFields {
  return {
    layers: state.layers,
    layerGroups: state.layerGroups,
    palette: state.palette,
    modelType: state.modelType,
    showLayer2: state.showLayer2,
    preservePixels: state.preservePixels,
    canvasBackground: state.canvasBackground,
  };
}

// ---- テスト用のプロジェクトデータ ----

function makePixels(paint: Array<[x: number, y: number, color: RGBA]>): LayerPixels {
  const pixels: LayerPixels = Array.from({ length: SKIN_HEIGHT }, () =>
    Array.from({ length: SKIN_WIDTH }, () => null),
  );
  for (const [x, y, color] of paint) pixels[y][x] = { ...color };
  return pixels;
}

function makeLayer(id: string, order: number, paint: Array<[number, number, RGBA]>, extra: Partial<Layer> = {}): Layer {
  return {
    id,
    name: `レイヤー ${id}`,
    baseColor: paint[0]?.[2] ?? RED,
    noiseSettings: { brightness: 0, hue: 0 },
    groupId: null,
    order,
    layerType: 'direct',
    visible: true,
    opacity: 100,
    pixels: makePixels(paint),
    ...extra,
  };
}

// 保存済みプロジェクト（2 レイヤー・1 グループ・パレット・各種設定）
function sampleProject(): SavedProject {
  return {
    // partialize と同じキー順（読み込んだ JSON と書き込む JSON を比較できるように）
    state: {
      layers: [
        makeLayer('layer-a', 0, [[1, 2, RED]], { groupId: 'group-1', name: '肌' }),
        makeLayer('layer-b', 1, [[3, 4, GREEN], [5, 6, BLUE]], { name: '服', layerType: 'singleColor' }),
      ],
      layerGroups: [{ id: 'group-1', name: '頭', collapsed: true, order: 0, visible: true }],
      palette: [{ id: 'pal-1', color: { ...BLUE }, name: '空' }],
      modelType: 'alex',
      showLayer2: false,
      preservePixels: true,
      canvasBackground: { type: 'solid', color: '#224466' },
    },
    version: 0,
  };
}

// ---- IndexedDB ヘルパー（アプリとは別の接続を使う） ----

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// アプリと同じスキーマ（バージョン 1・オブジェクトストア "store"）で接続を開く
function openDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(OBJECT_STORE);
  };
  return requestResult(request);
}

// 保存されている生の値を読む。
// readwrite で読むため、先に発行されたトランザクション（アプリの読み込み・書き込み）が
// すべて終わってから読まれる。書き込みの完了を待つ区切りとしても使う
async function readRaw(): Promise<unknown> {
  const db = await openDb();
  try {
    const tx = db.transaction(OBJECT_STORE, 'readwrite');
    const done = transactionDone(tx);
    const request = tx.objectStore(OBJECT_STORE).get(PROJECT_KEY);
    await done;
    return request.result;
  } finally {
    db.close();
  }
}

const waitForIdb = async (): Promise<void> => {
  await readRaw();
};

async function readSaved(): Promise<SavedProject> {
  const raw = await readRaw();
  if (typeof raw !== 'string') throw new Error(`保存データがありません: ${String(raw)}`);
  return JSON.parse(raw) as SavedProject;
}

// 保存データを直接書き込む（put のスパイに数えられないよう add を使う）
async function seedRaw(value: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(OBJECT_STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(OBJECT_STORE).add(value, PROJECT_KEY);
    await done;
  } finally {
    db.close();
  }
}

async function seedProject(project: SavedProject = sampleProject()): Promise<string> {
  const json = JSON.stringify(project);
  await seedRaw(json);
  return json;
}

// 別の接続で "store" に readwrite トランザクションを張り続け、アプリの読み込みを待たせる。
// 返り値の関数で解放する（解放し忘れても afterEach で解放する）
const activeHolds: Array<() => Promise<void>> = [];

async function holdObjectStore(): Promise<() => Promise<void>> {
  const db = await openDb();
  const tx = db.transaction(OBJECT_STORE, 'readwrite');
  const done = transactionDone(tx);
  const objectStore = tx.objectStore(OBJECT_STORE);
  let released = false;
  const keepAlive = () => {
    if (!released) objectStore.get('__hold__').onsuccess = keepAlive;
  };
  keepAlive();
  const release = async () => {
    released = true;
    await done;
    db.close();
  };
  activeHolds.push(release);
  return release;
}

// 実時間のタスクを 1 つ進める（setImmediate は偽物にしていない）
const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve));

async function until(condition: () => boolean, maxTasks = 2000): Promise<void> {
  for (let i = 0; i < maxTasks; i++) {
    if (condition()) return;
    await nextTask();
  }
  throw new Error('条件が満たされませんでした');
}

// ---- ストアの読み込み ----

interface LoadedStore {
  useEditorStore: EditorStore;
  engine: EngineMock;
}

// ページの読み込みを再現する（モジュールを読み直して新しいストアを作る。読み込みはここで始まる）
async function loadStore(): Promise<LoadedStore> {
  vi.resetModules();
  // モック済みモジュールは resetModules 後も同じインスタンスが返るため、ストアが実際に使う
  // エンジンを取得し、前の読み込みでの呼び出し記録を消しておく
  const { engine } = (await import('../lib/pixelEngine')) as unknown as typeof import('../test/pixelEngineMock');
  for (const fn of Object.values(engine)) fn.mockClear();
  const { useEditorStore } = await import('./editorStore');
  return { useEditorStore, engine };
}

function waitForHydration(store: EditorStore): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

async function loadHydratedStore(): Promise<LoadedStore> {
  const loaded = await loadStore();
  await waitForHydration(loaded.useEditorStore);
  return loaded;
}

// アプリの読み込み（get）が発行され、読み込み待ちになるまで進める
async function waitUntilReadIssued(getSpy: { mock: { calls: unknown[][] } }): Promise<void> {
  await until(() => getSpy.mock.calls.some(([key]) => key === PROJECT_KEY));
}

// ---- ページイベント ----

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

function firePageHide() {
  window.dispatchEvent(new Event('pagehide'));
}

// ---- セットアップ ----

let putSpy: MockInstance<IDBObjectStore['put']>;
let factory: IDBFactory;

// ストアが window / document に登録したリスナーを、テストの終わりに取り外す
// （前のテストのストアが後のテストのイベントで書き込まないように）
const addedListeners: Array<[EventTarget, string, EventListenerOrEventListenerObject | null]> = [];

function captureListeners(target: EventTarget) {
  const original = target.addEventListener.bind(target);
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    addedListeners.push([target, type, listener]);
    original(type, listener, options);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  factory = new IDBFactory();
  globalThis.indexedDB = factory;
  putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
  captureListeners(window);
  captureListeners(document);

  // ID 生成（Math.random）を決定的にする
  let n = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => (++n * 0.6180339887) % 1);
});

afterEach(async () => {
  for (const release of activeHolds.splice(0)) await release();
  for (const [target, type, listener] of addedListeners.splice(0)) {
    target.removeEventListener(type, listener);
  }
  vi.useRealTimers();
});

// ================================================================
// 読み込み（hydration）
// ================================================================
describe('読み込み', () => {
  it('保存したプロジェクトを再読み込みすると、永続化対象のフィールドが復元される', async () => {
    // 1 回目の訪問: 編集して保存する
    const first = await loadHydratedStore();
    const s = () => first.useEditorStore.getState();
    const groupId = s().createLayerGroup('服');
    const shirtId = s().createLayer('シャツ', RED, 'singleColor');
    s().setPixel(1, 2, BLUE); // singleColor なので基本色（赤）で塗られる
    s().commitDrawing();
    s().moveLayerToGroup(shirtId, groupId);
    const lineId = s().createLayer('線画', BLACK, 'direct');
    s().setPixel(3, 4, GREEN);
    s().commitDrawing();
    s().addToPalette(GREEN, '葉');
    s().setModelType('alex');
    s().toggleLayer2();
    s().togglePreservePixels();
    s().setCanvasBackground({ type: 'solid', color: '#336699' });
    // 永続化対象外
    s().setActiveTool('eraser');
    s().setHighlightedLayer(shirtId);
    s().setDrawingColor(BLUE);

    firePageHide();
    await waitForIdb();
    const expected = persistedFields(s());

    // 2 回目の訪問: 読み込み
    const { useEditorStore } = await loadHydratedStore();
    const state = useEditorStore.getState();

    expect(persistedFields(state)).toEqual(expected);
    expect(state.layers.map((l) => l.id)).toEqual([shirtId, lineId]);
    expect(state.layers[0].groupId).toBe(groupId);
    expect(state.layers[0].pixels[2][1]).toEqual(RED);
    expect(state.layers[1].pixels[4][3]).toEqual(GREEN);
    expect(state.palette).toEqual([{ id: expect.any(String), color: GREEN, name: '葉' }]);
    expect(state.modelType).toBe('alex');
    expect(state.showLayer2).toBe(false);
    expect(state.preservePixels).toBe(true);
    expect(state.canvasBackground).toEqual({ type: 'solid', color: '#336699' });

    // 永続化対象外のフィールドは初期値
    expect(state.activeTool).toBe('pencil');
    expect(state.highlightedLayerId).toBeNull();
    expect(state.activeLayerId).toBeNull();
    expect(state.drawingColor).toEqual(BLACK);
    expect(state.history).toEqual([]);
    expect(state.historyIndex).toBe(-1);

    // 読み込んだレイヤーから合成結果が作られる
    expect(state.getComposite()[2][1]).toEqual(RED);
    expect(state.getComposite()[4][3]).toEqual(GREEN);
  });

  it('保存形式（{ state, version } の JSON 文字列）のデータを読み込める', async () => {
    const project = sampleProject();
    await seedProject(project);

    const { useEditorStore } = await loadHydratedStore();

    expect(persistedFields(useEditorStore.getState())).toEqual(project.state);
  });

  it('レイヤーがあれば読み込み後に PixelEngine を作り直す（clearAllLayers → createLayer / setLayerData）', async () => {
    await seedProject();

    const { useEditorStore, engine } = await loadHydratedStore();

    expect(useEditorStore.getState().layers).toHaveLength(2);
    expect(engine.clearAllLayers).toHaveBeenCalledTimes(1);
    expect(engine.createLayer.mock.calls).toEqual([
      ['layer-a', 0],
      ['layer-b', 1],
    ]);
    expect(engine.clearAllLayers.mock.invocationCallOrder[0]).toBeLessThan(
      engine.createLayer.mock.invocationCallOrder[0],
    );

    expect(engine.setLayerData).toHaveBeenCalledTimes(2);
    const [[idA, orderA, dataA], [idB, orderB, dataB]] = engine.setLayerData.mock.calls as Array<
      [string, number, Uint8ClampedArray]
    >;
    expect([idA, orderA, idB, orderB]).toEqual(['layer-a', 0, 'layer-b', 1]);
    expect(dataA).toBeInstanceOf(Uint8ClampedArray);
    expect(dataA).toHaveLength(SKIN_WIDTH * SKIN_HEIGHT * 4);

    const rgbaAt = (data: Uint8ClampedArray, x: number, y: number) => {
      const i = (y * SKIN_WIDTH + x) * 4;
      return Array.from(data.slice(i, i + 4));
    };
    const paintedCount = (data: Uint8ClampedArray) => {
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
      return count;
    };
    expect(rgbaAt(dataA, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(paintedCount(dataA)).toBe(1);
    expect(rgbaAt(dataB, 3, 4)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(dataB, 5, 6)).toEqual([0, 0, 255, 255]);
    expect(paintedCount(dataB)).toBe(2);
  });

  it('保存データがなければ PixelEngine を操作しない', async () => {
    const { engine } = await loadHydratedStore();

    expect(engine.clearAllLayers).not.toHaveBeenCalled();
    expect(engine.createLayer).not.toHaveBeenCalled();
    expect(engine.setLayerData).not.toHaveBeenCalled();
  });

  it('保存データのレイヤーが 0 件なら PixelEngine を操作しない', async () => {
    const project = sampleProject();
    project.state.layers = [];
    await seedProject(project);

    const { useEditorStore, engine } = await loadHydratedStore();

    expect(useEditorStore.getState().modelType).toBe('alex');
    expect(engine.clearAllLayers).not.toHaveBeenCalled();
    expect(engine.createLayer).not.toHaveBeenCalled();
    expect(engine.setLayerData).not.toHaveBeenCalled();
  });

  it('保存データに無いフィールドは初期値のまま', async () => {
    await seedRaw(JSON.stringify({ state: { modelType: 'alex', showLayer2: false }, version: 0 }));

    const { useEditorStore } = await loadHydratedStore();
    const state = useEditorStore.getState();

    expect(state.modelType).toBe('alex');
    expect(state.showLayer2).toBe(false);
    expect(state.layers).toEqual([]);
    expect(state.layerGroups).toEqual([]);
    expect(state.palette).toEqual([]);
    expect(state.preservePixels).toBe(false);
    expect(state.canvasBackground).toEqual(DEFAULT_CANVAS_BACKGROUND);
  });

  it('IndexedDB の接続は使い回し、書き込みのたびに開き直さない', async () => {
    const openSpy = vi.spyOn(factory, 'open');
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await nextTask();
    s().toggleLayer2();
    firePageHide();
    await nextTask();
    s().addToPalette(RED);
    setVisibility('hidden');

    // アプリの接続だけを数える（readRaw の接続を開く前に確認する）
    await until(() => putSpy.mock.calls.length === 3);
    expect(openSpy).toHaveBeenCalledTimes(1);

    const saved = await readSaved();
    expect(saved.state.modelType).toBe('alex');
    expect(saved.state.showLayer2).toBe(false);
    expect(saved.state.palette).toHaveLength(1);
  });
});

// ================================================================
// merge: 読み込み前に計算された合成結果の破棄
// ================================================================
describe('読み込み時の合成キャッシュ', () => {
  it('読み込み前に計算した空の合成結果は破棄され、読み込んだレイヤーで計算し直される', async () => {
    await seedProject();
    const release = await holdObjectStore();
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    const { useEditorStore } = await loadStore();
    await waitUntilReadIssued(getSpy);
    expect(useEditorStore.persist.hasHydrated()).toBe(false);

    // 初回描画で合成結果が計算される（この時点ではレイヤーがないので空）
    const before = useEditorStore.getState().getComposite();
    expect(before[2][1]).toEqual(TRANSPARENT);
    expect(useEditorStore.getState().compositeCache).toBe(before);
    const versionBefore = useEditorStore.getState().previewVersion;

    await release();
    await waitForHydration(useEditorStore);

    const state = useEditorStore.getState();
    expect(state.compositeCache).toBeNull();
    // 再描画させるためにプレビューのバージョンが進む
    expect(state.previewVersion).toBe(versionBefore + 1);
    expect(state.getComposite()[2][1]).toEqual(RED);
    expect(state.getComposite()[4][3]).toEqual(GREEN);
  });

  it('保存データがない場合も、読み込み後は合成キャッシュが破棄されプレビューのバージョンが進む', async () => {
    const { useEditorStore } = await loadHydratedStore();

    expect(useEditorStore.getState().compositeCache).toBeNull();
    expect(useEditorStore.getState().previewVersion).toBe(1);
  });
});

// ================================================================
// 永続化対象が変わらない set
// ================================================================
describe('永続化対象が変わらない set', () => {
  it('ストアを作って読み込んだだけでは書き込まない', async () => {
    const json = await seedProject();
    await loadHydratedStore();

    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    setVisibility('hidden');
    firePageHide();
    await waitForIdb();

    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBe(json);
  });

  it('ハイライト・ツール・描画色・合成キャッシュ・プレビュー更新などの set では書き込まない', async () => {
    const json = await seedProject();
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();
    const versionBefore = s().previewVersion;

    s().setHighlightedLayer('layer-a');
    s().setHighlightedLayer(null);
    s().setActiveTool('eraser');
    s().setActiveTool('eyedropper');
    s().applyPickedColor(GREEN);
    s().startLayerColorPick('layer-a');
    s().endLayerColorPick();
    s().setActiveLayer('layer-b');
    s().setDrawingColor(BLUE);
    s().commitDrawing();
    s().getComposite();
    s().getComposite();
    useEditorStore.setState((state) => ({ previewVersion: state.previewVersion + 1 }));
    // 同じ値の設定（参照が変わらない）
    s().setModelType('alex');
    s().setCanvasBackground(s().canvasBackground);

    // set が実際に行われていることを確認
    expect(s().previewVersion).toBe(versionBefore + 2);
    expect(s().drawingColor).toEqual(BLUE);
    expect(s().compositeCache).not.toBeNull();

    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    setVisibility('hidden');
    firePageHide();
    await waitForIdb();

    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBe(json);
  });

  it('保存データがない場合も、一度書き込んだ後は永続化対象外の set で書き込まない', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    s().setHighlightedLayer('x');
    s().setActiveTool('rectangle');
    s().getComposite();
    s().commitDrawing();
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    firePageHide();
    await waitForIdb();

    expect(putSpy).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// 書き込みの間引き（debounce 400ms・最大 2000ms）
// ================================================================
describe('書き込みの間引き', () => {
  const background = (i: number): CanvasBackground => ({
    type: 'solid',
    color: `#${i.toString(16).padStart(6, '0')}`,
  });

  it('最後の変更から 400ms 後に 1 回だけ書き込む', async () => {
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.getState().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.modelType).toBe('alex');

    // その後は何も起きない
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('400ms 以内に続いた変更はまとめて 1 回で書き込み、最後の値が保存される', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    for (let i = 1; i <= 4; i++) {
      s().setCanvasBackground(background(i));
      vi.advanceTimersByTime(DEBOUNCE_MS - 100);
      await nextTask();
      expect(putSpy).not.toHaveBeenCalled();
    }
    // 最後の変更から 399ms
    vi.advanceTimersByTime(99);
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.canvasBackground).toEqual(background(4));
  });

  it('変更が途切れなくても、最初の未保存の変更から 2000ms で書き込む（以降も 2000ms ごと）', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    // 100ms ごとに変更し続ける（400ms 空くことがない）
    let i = 0;
    for (; i < MAX_WAIT_MS / 100; i++) {
      s().setCanvasBackground(background(i));
      await waitForIdb();
      expect(putSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
    }
    // 最初の変更から 2000ms: 直前（1900ms）の値が書き込まれる
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.canvasBackground).toEqual(background(i - 1));

    // 次の区間も最初の変更（2000ms）から 2000ms で書き込む
    for (; i < (MAX_WAIT_MS * 2) / 100; i++) {
      s().setCanvasBackground(background(i));
      await nextTask();
      expect(putSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
    }
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect((await readSaved()).state.canvasBackground).toEqual(background(i - 1));
  });

  it('最大待ち時間の直前の変更でも、書き込みは 2000ms の時点で行われる', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setCanvasBackground(background(1));
    vi.advanceTimersByTime(350);
    s().setCanvasBackground(background(2));
    vi.advanceTimersByTime(350);
    s().setCanvasBackground(background(3));
    vi.advanceTimersByTime(350);
    s().setCanvasBackground(background(4));
    vi.advanceTimersByTime(350);
    s().setCanvasBackground(background(5));
    vi.advanceTimersByTime(350);
    // 1750ms: debounce なら 2150ms だが、最大待ち時間で 2000ms に書き込む
    s().setCanvasBackground(background(6));
    vi.advanceTimersByTime(249);
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.canvasBackground).toEqual(background(6));
  });

  it('書き込み後の変更は、改めて 400ms 待ってから書き込む', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    s().toggleLayer2();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect((await readSaved()).state).toMatchObject({ modelType: 'alex', showLayer2: false });
  });
});

// ================================================================
// 同一内容の書き込み省略
// ================================================================
describe('同じ内容の書き込み省略', () => {
  it('読み込んだ内容と同じ JSON になる変更（参照だけ新しい）は書き戻さない', async () => {
    const json = await seedProject();
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.setState((state) => ({
      layers: state.layers.map((l) => ({ ...l })),
      layerGroups: [...state.layerGroups],
      palette: [...state.palette],
      canvasBackground: { ...state.canvasBackground },
    }));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    firePageHide();
    await waitForIdb();

    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBe(json);
  });

  it('変更してから元に戻した場合は書き込まない', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    s().toggleLayer2();
    s().toggleLayer2();
    s().setModelType('steve');
    s().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    // 元に戻さなければ書き込む
    s().toggleLayer2();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
  });

  it('書き込んだ内容と同じなら pagehide でも書き込まない', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    s().setCanvasBackground({ ...s().canvasBackground });
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// ページを離れるときの書き込み
// ================================================================
describe('ページを離れるときの書き込み', () => {
  it('visibilitychange で非表示になると、待たずに書き込む', async () => {
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.getState().setModelType('alex');
    setVisibility('hidden');
    await waitForIdb();

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.modelType).toBe('alex');

    // 保留中のタイマーは取り消されている
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('表示状態への visibilitychange では書き込まず、通常どおり 400ms 後に書き込む', async () => {
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.getState().setModelType('alex');
    setVisibility('visible');
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('pagehide で待たずに書き込む', async () => {
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.getState().addToPalette(RED, '赤');
    firePageHide();
    await waitForIdb();

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.palette).toEqual([{ id: expect.any(String), color: RED, name: '赤' }]);

    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it('pagehide で書き込んだ後の変更は、そこから改めて 400ms 待つ', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    vi.advanceTimersByTime(300);
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    s().toggleLayer2();
    // 最初の変更から 400ms（取り消されたタイマーの時刻）では書き込まない
    vi.advanceTimersByTime(50);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DEBOUNCE_MS - 51);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
  });

  it('未保存の変更がなければ、非表示・pagehide でも書き込まない', async () => {
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.getState().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
  });
});

// ================================================================
// 読み込み完了前の書き込み（保存済みプロジェクトの保護）
// ================================================================
describe('読み込み完了前の書き込み', () => {
  it('読み込みが遅くても、読み込み前の set・タイマー・ページ非表示で保存済みプロジェクトを上書きしない', async () => {
    const project = sampleProject();
    const json = await seedProject(project);
    const release = await holdObjectStore();
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    const { useEditorStore } = await loadStore();
    await waitUntilReadIssued(getSpy);
    expect(useEditorStore.persist.hasHydrated()).toBe(false);
    expect(useEditorStore.getState().layers).toEqual([]);

    // 起動直後の（永続化対象外の）set。初期状態（空）が書き込み待ちになる
    useEditorStore.getState().getComposite();
    useEditorStore.getState().setHighlightedLayer('x');
    useEditorStore.getState().setActiveTool('eraser');
    // 読み込みが終わる前にタイマーやページ非表示が起きる
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    setVisibility('hidden');
    firePageHide();
    for (let i = 0; i < 20; i++) await nextTask();

    expect(putSpy).not.toHaveBeenCalled();
    expect(useEditorStore.persist.hasHydrated()).toBe(false);

    await release();
    await waitForHydration(useEditorStore);

    // 保存済みプロジェクトが読み込まれ、保存データも元のまま
    expect(persistedFields(useEditorStore.getState())).toEqual(project.state);
    expect(await readRaw()).toBe(json);
    expect(putSpy).not.toHaveBeenCalled();

    // 読み込み後にタイマー・ページ非表示が起きても書き込まない
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    setVisibility('hidden');
    firePageHide();
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBe(json);

    // 読み込み後の変更は、読み込んだプロジェクトに対する変更として保存される
    useEditorStore.getState().setModelType('steve');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    const saved = await readSaved();
    expect(saved.state).toEqual({ ...project.state, modelType: 'steve' });
  });

  it('読み込み前の永続化対象の変更は、保存データがあれば保存データで置き換えられ、書き込まれない', async () => {
    const project = sampleProject();
    const json = await seedProject(project);
    const release = await holdObjectStore();
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    const { useEditorStore } = await loadStore();
    await waitUntilReadIssued(getSpy);
    useEditorStore.getState().setModelType('steve');
    useEditorStore.getState().createLayerGroup('読み込み前');

    await release();
    await waitForHydration(useEditorStore);

    expect(useEditorStore.getState().modelType).toBe('alex');
    expect(useEditorStore.getState().layerGroups).toEqual(project.state.layerGroups);

    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    firePageHide();
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBe(json);
  });
});

// ================================================================
// 読み込み中に始めた操作と元に戻す
// ================================================================
describe('読み込み中に始めた操作と元に戻す', () => {
  it('読み込み中に描き始めたストロークを読み込み後に元に戻しても、読み込んだプロジェクトは消えない', async () => {
    const project = sampleProject();
    await seedProject(project);
    const release = await holdObjectStore();
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    const { useEditorStore } = await loadStore();
    const s = () => useEditorStore.getState();
    await waitUntilReadIssued(getSpy);

    // 読み込み完了前に描き始める（レイヤーが自動作成され、元に戻す用のスナップショットが取られる）
    s().setPixel(10, 10, RED);

    await release();
    await waitForHydration(useEditorStore);
    // 読み込み前の履歴は残らない
    expect(s().history).toEqual([]);
    expect(s().historyIndex).toBe(-1);

    // 読み込み後に同じストロークを続けて確定し、元に戻す
    s().setPixel(11, 10, RED);
    s().commitDrawing();
    s().undo();

    // 読み込んだレイヤー・グループはそのまま残る
    for (const layer of project.state.layers) {
      const current = s().layers.find((l) => l.id === layer.id);
      expect(current?.pixels).toEqual(layer.pixels);
    }
    expect(s().layerGroups).toEqual(project.state.layerGroups);

    // 保存されるのも、読み込んだプロジェクトが残った状態
    vi.advanceTimersByTime(MAX_WAIT_MS);
    firePageHide();
    await waitForIdb();
    const saved = await readSaved();
    expect(saved.state.layers.map((l) => l.id)).toEqual(expect.arrayContaining(['layer-a', 'layer-b']));
    expect(saved.state.layerGroups).toEqual(project.state.layerGroups);
  });
});

// ================================================================
// 初回訪問（保存データなし）
// ================================================================
describe('初回訪問（保存データなし）', () => {
  it('読み込み完了前の変更は、読み込み完了後に（400ms 待って）保存される', async () => {
    // DB はあるが保存データはない状態で、読み込みを待たせる
    const release = await holdObjectStore();
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    const { useEditorStore } = await loadStore();
    await waitUntilReadIssued(getSpy);
    useEditorStore.getState().getComposite();
    useEditorStore.getState().setModelType('alex');
    const groupId = useEditorStore.getState().createLayerGroup('グループ');

    // 保存データの有無が分かるまでは、タイマー・ページ非表示でも書き込まない
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    setVisibility('hidden');
    firePageHide();
    for (let i = 0; i < 20; i++) await nextTask();
    expect(putSpy).not.toHaveBeenCalled();

    await release();
    await waitForHydration(useEditorStore);

    // 読み込み前の変更は残っている
    expect(useEditorStore.getState().modelType).toBe('alex');
    expect(useEditorStore.getState().layerGroups.map((g) => g.id)).toEqual([groupId]);

    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    const saved = await readSaved();
    expect(saved.state.modelType).toBe('alex');
    expect(saved.state.layerGroups).toEqual([
      { id: groupId, name: 'グループ', collapsed: false, order: 0, visible: true },
    ]);
  });

  it('DB がまだない場合も、読み込み後の変更は保存される', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    const layerId = s().createLayer('新規', RED, 'direct');
    s().setPixel(0, 0, RED);
    s().setPixel(63, 63, BLUE);
    s().commitDrawing();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const saved = await readSaved();
    expect(saved.version).toBe(0);
    expect(saved.state.layers).toHaveLength(1);
    expect(saved.state.layers[0].id).toBe(layerId);
    expect(saved.state.layers[0].pixels[0][0]).toEqual(RED);
    expect(saved.state.layers[0].pixels[63][63]).toEqual(BLUE);
    expect(saved.state.layers[0].pixels[0][1]).toBeNull();
    // 永続化対象のフィールドだけが保存される
    expect(Object.keys(saved.state).sort()).toEqual(
      ['canvasBackground', 'layerGroups', 'layers', 'modelType', 'palette', 'preservePixels', 'showLayer2'],
    );
  });
});

// ================================================================
// 異常系・保存データの削除
// ================================================================
describe('異常系', () => {
  it('書き込みに失敗したら、次の set() で（永続化対象が変わっていなくても）書き込み直す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { useEditorStore } = await loadHydratedStore();
    putSpy.mockImplementationOnce(() => {
      throw new DOMException('容量が足りません', 'QuotaExceededError');
    });

    useEditorStore.getState().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(await readRaw()).toBeUndefined();

    // 永続化対象外の set でも書き込み直す
    useEditorStore.getState().setHighlightedLayer('x');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect((await readSaved()).state.modelType).toBe('alex');
  });

  it('保存データが壊れていて読み込めない場合は、積まれていた変更を書き込んで保存を続ける', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRaw('{壊れたデータ');
    const release = await holdObjectStore();
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    const { useEditorStore } = await loadStore();
    await waitUntilReadIssued(getSpy);
    useEditorStore.getState().setModelType('alex');

    await release();
    // 読み込み（失敗）が終わるまで待つ
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().layers).toEqual([]);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.modelType).toBe('alex');

    // 以降の変更も保存される
    useEditorStore.getState().toggleLayer2();
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect((await readSaved()).state).toMatchObject({ modelType: 'alex', showLayer2: false });
  });

  it('保存データが壊れていて読み込めない場合、変更がなければ（起動時の set・タイマー・ページ非表示でも）上書きしない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = '{"state":{"layers":[{"id":"x"';
    await seedRaw(broken);

    const { useEditorStore } = await loadStore();
    // 起動直後の（永続化対象外の）set。初期状態（空）が書き込み待ちになる
    useEditorStore.getState().getComposite();
    // 読み込み（失敗）が終わるまで待つ
    await until(() => consoleError.mock.calls.length > 0);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('読み込めません'), expect.anything());

    // 読み込み後も、永続化対象外の set・タイマー・ページ非表示では書き込まない
    useEditorStore.getState().setHighlightedLayer('x');
    useEditorStore.getState().getComposite();
    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    setVisibility('hidden');
    firePageHide();
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBe(broken);

    // 実際に変更したら保存される
    useEditorStore.getState().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect((await readSaved()).state.modelType).toBe('alex');
  });

  it('別のタブで DB が削除されると接続を閉じ、次の書き込みで開き直して保存する', async () => {
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    s().setModelType('alex');
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(1);

    // アプリが接続を閉じなければ blocked になり、削除が終わらない
    const request = indexedDB.deleteDatabase(DB_NAME);
    const onBlocked = vi.fn();
    request.onblocked = onBlocked;
    await requestResult(request);
    expect(onBlocked).not.toHaveBeenCalled();

    s().toggleLayer2();
    firePageHide();
    await waitForIdb();
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect((await readSaved()).state).toMatchObject({ modelType: 'alex', showLayer2: false });
  });

  it('clearStorage で保存データを削除し、保留中の書き込みも取り消す', async () => {
    await seedProject();
    const { useEditorStore } = await loadHydratedStore();

    useEditorStore.getState().setModelType('steve');
    useEditorStore.persist.clearStorage();
    await waitForIdb();
    expect(await readRaw()).toBeUndefined();

    vi.advanceTimersByTime(MAX_WAIT_MS * 5);
    firePageHide();
    await waitForIdb();
    expect(putSpy).not.toHaveBeenCalled();
    expect(await readRaw()).toBeUndefined();
  });

  it('clearStorage の後の変更は、削除前に書き込んだ内容と同じでも保存される', async () => {
    const json = await seedProject();
    const { useEditorStore } = await loadHydratedStore();
    const s = () => useEditorStore.getState();

    useEditorStore.persist.clearStorage();
    await waitForIdb();

    // 削除前（読み込み時）と同じ内容に戻る変更
    s().setModelType('steve');
    s().setModelType('alex');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitForIdb();

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(await readRaw()).toBe(json);
  });
});
