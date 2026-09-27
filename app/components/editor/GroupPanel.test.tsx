// @vitest-environment jsdom
// レイヤーパネルのドラッグ＆ドロップ（並べ替え・グループ間の移動）と履歴のテスト
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { engine } from '../../test/pixelEngineMock';
import { GroupPanel } from './GroupPanel';
import { useEditorStore } from '../../stores/editorStore';
import {
  SKIN_HEIGHT,
  SKIN_WIDTH,
  type Layer,
  type LayerGroup,
  type LayerPixels,
} from '../../types/editor';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
// jsdom には DragEvent がなく、ドラッグイベントに clientY を渡せないので MouseEvent で代用する
window.DragEvent ??= class extends MouseEvent {} as unknown as typeof DragEvent;

const s = () => useEditorStore.getState();

function emptyPixels(): LayerPixels {
  return Array.from({ length: SKIN_HEIGHT }, () => Array.from({ length: SKIN_WIDTH }, () => null));
}

function makeLayer(id: string, order: number, groupId: string | null = null): Layer {
  return {
    id,
    name: `レイヤー${id}`,
    baseColor: { r: 255, g: 255, b: 255, a: 255 },
    noiseSettings: { brightness: 0, hue: 0 },
    groupId,
    order,
    layerType: 'direct',
    visible: true,
    opacity: 100,
    pixels: emptyPixels(),
  };
}

function makeGroup(id: string, order: number): LayerGroup {
  return { id, name: `グループ${id}`, collapsed: false, order, visible: true };
}

// レイヤー・グループの並び（id, order, groupId）だけを取り出す
function arrangement() {
  return {
    layers: s().layers.map(({ id, order, groupId }) => ({ id, order, groupId })),
    groups: s().layerGroups.map(({ id, order }) => ({ id, order })),
  };
}

// jsdom はレイアウトしないので、どの要素も高さ 40px の矩形として扱う
// （レイヤー: 上半分 = 前、下半分 = 後ろ / グループ: 上下 12px = グループの外、中央 = グループの中）
const TOP = 5;
const MIDDLE = 20;
const BOTTOM = 35;

function layerCard(id: string): HTMLElement {
  return screen.getByText(`レイヤー${id}`).closest<HTMLElement>('[draggable]')!;
}

function groupHeader(id: string): HTMLElement {
  return screen.getByText(`グループ${id}`).closest<HTMLElement>('[draggable]')!;
}

// グループのドロップを受け取る枠（ヘッダーの親）
function groupDropArea(id: string): HTMLElement {
  return groupHeader(id).parentElement!;
}

function drag(source: HTMLElement, target: HTMLElement, clientY: number) {
  fireEvent.dragStart(source, { dataTransfer: { effectAllowed: '' } });
  fireEvent.dragOver(target, { clientY });
  fireEvent.drop(target, { clientY });
  fireEvent.dragEnd(source);
}

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
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  s().saveToHistory();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 40, right: 200, width: 200, height: 40,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ドラッグ＆ドロップでのレイヤーの並べ替え', () => {
  it('グループ外のレイヤーを別のレイヤーの後ろへ移すと、1 件の履歴として元に戻せる', () => {
    useEditorStore.setState({ layers: [makeLayer('A', 0), makeLayer('B', 1), makeLayer('C', 2)] });
    render(<GroupPanel />);
    const before = arrangement();

    drag(layerCard('A'), layerCard('C'), BOTTOM);

    const orderOf = (id: string) => s().layers.find((l) => l.id === id)!.order;
    expect(orderOf('B')).toBeLessThan(orderOf('C'));
    expect(orderOf('C')).toBeLessThan(orderOf('A'));
    expect(s().history).toHaveLength(1);
    const after = arrangement();

    s().undo();
    expect(arrangement()).toEqual(before);
    s().redo();
    expect(arrangement()).toEqual(after);
  });

  it('別のグループのレイヤーの前へ移すと、グループも変わり 1 件の履歴になる', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0), makeGroup('G2', 1)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('B', 1, 'G1'), makeLayer('C', 0, 'G2')],
    });
    render(<GroupPanel />);
    const before = arrangement();

    drag(layerCard('B'), layerCard('C'), TOP);

    const b = s().layers.find((l) => l.id === 'B')!;
    const c = s().layers.find((l) => l.id === 'C')!;
    expect(b.groupId).toBe('G2');
    expect(b.order).toBeLessThan(c.order);
    expect(s().history).toHaveLength(1);

    s().undo();
    expect(arrangement()).toEqual(before);
  });

  it('レイヤーをグループの中へドロップすると、そのグループに入り 1 件の履歴になる', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0), makeGroup('G2', 1)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('C', 0, 'G2')],
    });
    render(<GroupPanel />);
    const before = arrangement();

    drag(layerCard('A'), groupDropArea('G2'), MIDDLE);

    expect(s().layers.find((l) => l.id === 'A')!.groupId).toBe('G2');
    expect(s().history).toHaveLength(1);

    s().undo();
    expect(arrangement()).toEqual(before);
  });

  it('グループの上端へドロップすると、グループの外（グループなしの先頭）へ出て 1 件の履歴になる', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('X', 0), makeLayer('Y', 1)],
    });
    render(<GroupPanel />);
    const before = arrangement();

    drag(layerCard('A'), groupDropArea('G1'), TOP);

    const ungrouped = s().layers
      .filter((l) => l.groupId === null)
      .sort((p, q) => p.order - q.order)
      .map((l) => l.id);
    expect(ungrouped).toEqual(['A', 'X', 'Y']);
    expect(s().history).toHaveLength(1);

    s().undo();
    expect(arrangement()).toEqual(before);
  });

  it('パネルの空いている場所へドロップすると、グループの外へ出て 1 件の履歴になる', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('X', 0)],
    });
    const { container } = render(<GroupPanel />);
    const before = arrangement();
    const panelBody = container.querySelector<HTMLElement>('.overflow-auto')!;

    drag(layerCard('A'), panelBody, MIDDLE);

    expect(s().layers.find((l) => l.id === 'A')!.groupId).toBeNull();
    expect(s().history).toHaveLength(1);

    s().undo();
    expect(arrangement()).toEqual(before);
  });

  it('並べ替えを元に戻すと、PixelEngine の重なり順も戻る', () => {
    useEditorStore.setState({ layers: [makeLayer('A', 0), makeLayer('B', 1), makeLayer('C', 2)] });
    render(<GroupPanel />);

    drag(layerCard('A'), layerCard('C'), BOTTOM);
    vi.clearAllMocks();
    s().undo();

    for (const layer of s().layers) {
      const calls = engine.setLayerOrder.mock.calls.filter(([id]) => id === layer.id);
      if (calls.length > 0) expect(calls[calls.length - 1][1]).toBe(layer.order);
    }
    expect(engine.setLayerOrder).toHaveBeenCalled();
  });
});

describe('ドラッグ＆ドロップでのグループの並べ替え', () => {
  it('グループを別のグループの後ろへ移すと、1 件の履歴として元に戻せる', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0), makeGroup('G2', 1), makeGroup('G3', 2)],
    });
    render(<GroupPanel />);
    const before = arrangement();

    drag(groupHeader('G1'), groupDropArea('G3'), BOTTOM);

    const order = [...s().layerGroups].sort((p, q) => p.order - q.order).map((g) => g.id);
    expect(order).toEqual(['G2', 'G3', 'G1']);
    expect(s().history).toHaveLength(1);
    const after = arrangement();

    s().undo();
    expect(arrangement()).toEqual(before);
    s().redo();
    expect(arrangement()).toEqual(after);
  });
});

describe('並びが変わらないドロップ', () => {
  it('レイヤーを自分のグループの中へドロップしても、並びも履歴も変わらない', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('B', 1, 'G1'), makeLayer('C', 2, 'G1')],
    });
    render(<GroupPanel />);
    const before = arrangement();

    drag(layerCard('A'), groupDropArea('G1'), MIDDLE);

    expect(arrangement()).toEqual(before);
    expect(s().history).toHaveLength(0);
  });

  it('いまと同じ位置へのドロップは履歴を追加せず、やり直しも消えない', () => {
    // 削除などで order に隙間がある状態
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('C', 2, 'G1'), makeLayer('X', 0)],
    });
    render(<GroupPanel />);
    drag(layerCard('A'), layerCard('C'), BOTTOM); // 1 件目: A を C の後ろへ
    s().undo();
    const before = arrangement();

    drag(layerCard('A'), layerCard('C'), TOP); // A はすでに C の前にある

    expect(arrangement()).toEqual(before);
    expect(s().historyIndex).toBe(-1);
    s().redo();
    const order = s().layers.filter((l) => l.groupId === 'G1').sort((p, q) => p.order - q.order).map((l) => l.id);
    expect(order).toEqual(['C', 'A']);
  });

  it('グループをいまと同じ位置へドロップしても履歴を追加しない', () => {
    useEditorStore.setState({ layerGroups: [makeGroup('G1', 0), makeGroup('G2', 2)] });
    render(<GroupPanel />);
    const before = arrangement();

    drag(groupHeader('G1'), groupDropArea('G2'), TOP);

    expect(arrangement()).toEqual(before);
    expect(s().history).toHaveLength(0);
  });

  it('グループの外にあるレイヤーをグループの外の同じ位置へドロップしても履歴を追加しない', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0)],
      layers: [makeLayer('X', 0), makeLayer('Y', 3)],
    });
    render(<GroupPanel />);
    const before = arrangement();

    drag(layerCard('X'), groupDropArea('G1'), TOP); // グループの外の先頭へ（X はすでに先頭）

    expect(arrangement()).toEqual(before);
    expect(s().history).toHaveLength(0);
  });
});

describe('ドラッグ状態の後始末', () => {
  it('グループをまたいで移したあと、外部からのドロップ（ファイルなど）でレイヤーが動かない', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0)],
      layers: [makeLayer('A', 0, 'G1'), makeLayer('X', 0), makeLayer('Y', 1)],
    });
    render(<GroupPanel />);
    drag(layerCard('A'), layerCard('Y'), BOTTOM); // A をグループの外へ（カードが作り直され dragend が届かない）
    const before = arrangement();
    const historyLength = s().history.length;

    // dragstart のない外部からのドロップ
    fireEvent.dragOver(layerCard('X'), { clientY: TOP });
    fireEvent.drop(layerCard('X'), { clientY: TOP });
    fireEvent.dragOver(groupDropArea('G1'), { clientY: MIDDLE });
    fireEvent.drop(groupDropArea('G1'), { clientY: MIDDLE });

    expect(arrangement()).toEqual(before);
    expect(s().history).toHaveLength(historyLength);
  });
});

describe('レイヤー・グループの作成と履歴', () => {
  it('パネルのボタンでのレイヤー・グループの作成は、それぞれ 1 件の履歴として取り消せる', () => {
    const { container } = render(<GroupPanel />);

    fireEvent.click(container.querySelector('button:has(svg.lucide-plus)')!);
    fireEvent.click(container.querySelector('button:has(svg.lucide-folder-plus)')!);
    expect(s().layers).toHaveLength(1);
    expect(s().layerGroups).toHaveLength(1);
    expect(s().history).toHaveLength(2);

    s().undo();
    expect(s().layerGroups).toHaveLength(0);
    s().undo();
    expect(s().layers).toHaveLength(0);
    expect(engine.deleteLayer).toHaveBeenCalled();
  });

  it('並べ替え → レイヤー作成 → 取り消しで、重なり順の値が重複しない', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G', 0)],
      layers: [makeLayer('A', 0), makeLayer('B', 1), makeLayer('C', 2)],
    });
    const { container } = render(<GroupPanel />);
    drag(layerCard('B'), groupDropArea('G'), MIDDLE); // B をグループへ（A:0, C:2 が残る）
    drag(layerCard('A'), layerCard('C'), BOTTOM); // A を C の後ろへ（C:0, A:1）
    fireEvent.click(container.querySelector('button:has(svg.lucide-plus)')!); // 新しいレイヤー

    s().undo(); // 作成を取り消す
    s().undo(); // 並べ替えを取り消す

    const ungrouped = s().layers.filter((l) => l.groupId === null).map((l) => l.order);
    expect(new Set(ungrouped).size).toBe(ungrouped.length);
  });

  it('グループの並べ替え → グループ作成 → 取り消しで、グループの順番が重複しない', () => {
    useEditorStore.setState({ layerGroups: [makeGroup('G1', 0), makeGroup('G3', 2)] });
    const { container } = render(<GroupPanel />);
    drag(groupHeader('G1'), groupDropArea('G3'), BOTTOM); // G3:0, G1:1
    fireEvent.click(container.querySelector('button:has(svg.lucide-folder-plus)')!);

    s().undo();
    s().undo();

    const orders = s().layerGroups.map((g) => g.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('重なり順の値が同じときの表示と合成', () => {
  const RED = { r: 255, g: 0, b: 0, a: 255 };
  const BLUE = { r: 0, g: 0, b: 255, a: 255 };

  // パネルで上に表示されているレイヤーの色が、合成結果（キャンバス）で手前に見える
  function paint(layer: Layer, color: typeof RED): Layer {
    layer.pixels[0][0] = { ...color };
    return layer;
  }

  function panelOrder(): string[] {
    return [...document.querySelectorAll('div.rounded-lg.border.p-2[draggable] span.truncate')].map((e) => e.textContent!);
  }

  it('グループの外で order が同じレイヤーは、パネルで上にある方がキャンバスでも手前になる', () => {
    useEditorStore.setState({
      layers: [paint(makeLayer('X', 0), RED), paint(makeLayer('A', 0), BLUE)],
    });
    render(<GroupPanel />);

    const top = panelOrder()[0];
    const front = s().getComposite()[0][0];
    expect(front).toEqual(top === 'レイヤーX' ? RED : BLUE);
  });

  it('order が同じグループは、パネルで上にあるグループのレイヤーがキャンバスでも手前になる', () => {
    useEditorStore.setState({
      layerGroups: [makeGroup('G1', 0), makeGroup('G2', 0)],
      layers: [paint(makeLayer('X', 1, 'G1'), RED), paint(makeLayer('Z', 0, 'G2'), BLUE)],
    });
    render(<GroupPanel />);

    const top = panelOrder()[0];
    const front = s().getComposite()[0][0];
    expect(front).toEqual(top === 'レイヤーX' ? RED : BLUE);
  });
});
