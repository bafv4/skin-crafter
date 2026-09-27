// @vitest-environment jsdom
// Toolbar（ツール切り替え・キーボードショートカット・元に戻す/やり直し）のテスト
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Web Worker を起動しないよう PixelEngine をモックに差し替える
vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { Toolbar, TOOLS } from './Toolbar';
import { useEditorStore } from '../../stores/editorStore';
import type { HistoryEntry, RGBA, ToolType } from '../../types/editor';

// ---- jsdom に無い API の最小スタブ（Radix の Tooltip/Popover が使う） ----
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// ---- テスト用ヘルパー ----

const store = () => useEditorStore.getState();

const EMPTY_ENTRY: HistoryEntry = { pixelChanges: [], layerChanges: [], layerGroupChanges: [] };

// ツールバーのボタンはアイコンのみ（アクセシブルネームはツールチップ）なので、並び順で取り出す。
// 並び順そのものは「ツールチップの文言」テストで検証している
function getToolbarButtons() {
  const buttons = screen.getAllByRole<HTMLButtonElement>('button');
  return {
    tools: buttons.slice(0, TOOLS.length),
    preserve: buttons[TOOLS.length],
    undo: buttons[buttons.length - 2],
    redo: buttons[buttons.length - 1],
  };
}

function toolButton(type: ToolType) {
  const index = TOOLS.findIndex((t) => t.type === type);
  return getToolbarButtons().tools[index];
}

// 描画カラーのボタン（Popover のトリガーなので aria-expanded を持つ唯一のボタン）
function queryColorButton() {
  return screen.queryByRole('button', { expanded: false }) ?? screen.queryByRole('button', { expanded: true });
}

async function tooltipTextOnHover(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  // 直前のクリック等でポインタが乗ったままだと Radix が再度開かないため、一度外してから乗せる
  await user.unhover(element);
  await user.hover(element);
  const tooltip = await screen.findByRole('tooltip');
  const text = tooltip.textContent;
  // ツールチップを閉じる（Esc は Toolbar のショートカットに割り当てられていない）
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  return text;
}

// keydown を body から発火し、既定動作が取り消されたか（preventDefault されたか）を返す
function pressKey(init: KeyboardEventInit, target: Element = document.body) {
  const notCanceled = fireEvent.keyDown(target, init);
  return { defaultPrevented: !notCanceled };
}

beforeAll(async () => {
  // IndexedDB からの読み込み（非同期）がテスト中に割り込まないよう、完了を待っておく
  if (!useEditorStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsub = useEditorStore.persist.onFinishHydration(() => {
        unsub();
        resolve();
      });
    });
  }
});

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('Toolbar: ツールボタン', () => {
  it('TOOLS の順にツールボタンが並び、ホバーで「名前 (ショートカット)」が表示される', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const { tools } = getToolbarButtons();
    expect(tools).toHaveLength(5);

    for (const [i, tool] of TOOLS.entries()) {
      expect(await tooltipTextOnHover(user, tools[i])).toBe(`${tool.label} (${tool.shortcut})`);
    }
  });

  it('TOOLS のショートカット表記はキーボード操作と一致する', () => {
    expect(TOOLS.map((t) => [t.type, t.shortcut])).toEqual([
      ['pencil', 'P'],
      ['eraser', 'E'],
      ['rectangle', 'R'],
      ['rectangleEraser', 'Shift+E'],
      ['eyedropper', 'I'],
    ]);
  });

  it('クリックでツールが切り替わり、選択中のボタンだけが強調表示になる', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    for (const tool of TOOLS) {
      await user.click(toolButton(tool.type));
      expect(store().activeTool).toBe(tool.type);

      const highlighted = getToolbarButtons().tools.filter((b) => b.dataset.variant === 'default');
      expect(highlighted).toEqual([toolButton(tool.type)]);
    }
  });

  it('上書き禁止ボタンでモードが切り替わり、ツールチップの表記も変わる', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    expect(store().preservePixels).toBe(false);
    expect(await tooltipTextOnHover(user, getToolbarButtons().preserve)).toBe('上書き禁止モード (無効)');

    await user.click(getToolbarButtons().preserve);
    expect(store().preservePixels).toBe(true);
    expect(getToolbarButtons().preserve.dataset.variant).toBe('default');
    expect(await tooltipTextOnHover(user, getToolbarButtons().preserve)).toBe('上書き禁止モード (有効)');

    await user.click(getToolbarButtons().preserve);
    expect(store().preservePixels).toBe(false);
  });
});

describe('Toolbar: キーボードショートカット', () => {
  it.each<[string, KeyboardEventInit, ToolType, ToolType]>([
    ['P', { key: 'p' }, 'eraser', 'pencil'],
    ['E', { key: 'e' }, 'pencil', 'eraser'],
    ['Shift+E', { key: 'E', shiftKey: true }, 'pencil', 'rectangleEraser'],
    ['R', { key: 'r' }, 'pencil', 'rectangle'],
    ['I', { key: 'i' }, 'pencil', 'eyedropper'],
  ])('%s で対応するツールに切り替わり、キー入力を消費する（preventDefault）', (_name, init, from, to) => {
    useEditorStore.setState({ activeTool: from });
    render(<Toolbar />);

    const { defaultPrevented } = pressKey(init);

    expect(store().activeTool).toBe(to);
    expect(defaultPrevented).toBe(true);
    expect(toolButton(to).dataset.variant).toBe('default');
  });

  it('CapsLock 等で大文字になっていても（Shift なし）同じツールに切り替わる', () => {
    render(<Toolbar />);

    pressKey({ key: 'R' });
    expect(store().activeTool).toBe('rectangle');

    pressKey({ key: 'E' });
    expect(store().activeTool).toBe('eraser');

    pressKey({ key: 'P' });
    expect(store().activeTool).toBe('pencil');
  });

  it('Shift を押していない E は矩形消しゴムではなく消しゴムになる', () => {
    useEditorStore.setState({ activeTool: 'rectangleEraser' });
    render(<Toolbar />);

    pressKey({ key: 'e', shiftKey: false });
    expect(store().activeTool).toBe('eraser');
  });

  it('ショートカットに割り当てられていないキーは無視し、preventDefault もしない', () => {
    useEditorStore.setState({ activeTool: 'rectangle' });
    render(<Toolbar />);

    for (const key of ['x', 'Enter', ' ', 'Escape', 'ArrowUp', '1']) {
      expect(pressKey({ key }).defaultPrevented).toBe(false);
    }
    expect(store().activeTool).toBe('rectangle');
  });

  it('Ctrl/⌘ と同時押しのときはツールを切り替えない（ブラウザのショートカットを妨げない）', () => {
    render(<Toolbar />);

    expect(pressKey({ key: 'e', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(pressKey({ key: 'r', metaKey: true }).defaultPrevented).toBe(false);
    expect(pressKey({ key: 'i', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(store().activeTool).toBe('pencil');
  });

  it('入力欄で文字を入力している間はショートカットを無視し、文字はそのまま入力される', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toolbar />
        <input aria-label="名前" />
        <textarea aria-label="メモ" />
      </>
    );

    await user.type(screen.getByLabelText('名前'), 'pier');
    expect(screen.getByLabelText<HTMLInputElement>('名前').value).toBe('pier');
    expect(store().activeTool).toBe('pencil');

    await user.type(screen.getByLabelText('メモ'), 'eir');
    expect(screen.getByLabelText<HTMLTextAreaElement>('メモ').value).toBe('eir');
    expect(store().activeTool).toBe('pencil');
  });

  it('入力欄での keydown は preventDefault しない', () => {
    render(
      <>
        <Toolbar />
        <input aria-label="名前" />
      </>
    );
    const input = screen.getByLabelText('名前');

    expect(pressKey({ key: 'e' }, input).defaultPrevented).toBe(false);
    expect(store().activeTool).toBe('pencil');
  });

  describe('回帰: ツール切り替えで開いたダイアログの入力欄に、押したキーの文字が入らない', () => {
    // ツール切り替え（keydown の処理中）に入力欄へフォーカスが移る状況を再現する
    function setupFocusOnChange(shouldFocus: (event: KeyboardEvent) => boolean) {
      const input = document.createElement('input');
      document.body.appendChild(input);
      const onKeyDown = (e: KeyboardEvent) => {
        if (shouldFocus(e)) input.focus();
      };
      window.addEventListener('keydown', onKeyDown);
      return {
        input,
        dispose: () => window.removeEventListener('keydown', onKeyDown),
      };
    }

    it('前提: keydown が取り消されなければ、移動先の入力欄に文字が入る', async () => {
      const user = userEvent.setup();
      render(<Toolbar />);
      const { input, dispose } = setupFocusOnChange((e) => e.key === 'x');

      await user.keyboard('x');

      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('x');
      dispose();
    });

    it.each(['p', 'e', 'r', 'i'])('%s キーでツールが切り替わっても、文字は入力されない', async (key) => {
      useEditorStore.setState({ activeTool: key === 'p' ? 'eraser' : 'pencil' });
      const user = userEvent.setup();
      render(<Toolbar />);

      // ストアのツールが変わった瞬間（= Toolbar の keydown 処理中）にフォーカスを移す
      const input = document.createElement('input');
      document.body.appendChild(input);
      const unsubscribe = useEditorStore.subscribe((state, prev) => {
        if (state.activeTool !== prev.activeTool) input.focus();
      });

      await user.keyboard(key);

      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('');
      unsubscribe();
    });
  });

  describe('元に戻す / やり直し', () => {
    function withSpies() {
      const undo = vi.fn();
      const redo = vi.fn();
      useEditorStore.setState({ undo, redo });
      return { undo, redo };
    }

    it('Ctrl+Z / ⌘+Z で undo を呼び、既定動作を取り消す', () => {
      const { undo, redo } = withSpies();
      render(<Toolbar />);

      expect(pressKey({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(pressKey({ key: 'z', metaKey: true }).defaultPrevented).toBe(true);

      expect(undo).toHaveBeenCalledTimes(2);
      expect(redo).not.toHaveBeenCalled();
    });

    it('Ctrl+Y / ⌘+Y と ⌘+Shift+Z で redo を呼ぶ', () => {
      const { undo, redo } = withSpies();
      render(<Toolbar />);

      expect(pressKey({ key: 'y', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(pressKey({ key: 'y', metaKey: true }).defaultPrevented).toBe(true);
      // macOS では ⌘ 押下中の key は Shift があっても小文字になる
      expect(pressKey({ key: 'z', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);

      expect(redo).toHaveBeenCalledTimes(3);
      expect(undo).not.toHaveBeenCalled();
    });

    it('修飾キーなしの Z / Y は何もしない', () => {
      const { undo, redo } = withSpies();
      render(<Toolbar />);

      expect(pressKey({ key: 'z' }).defaultPrevented).toBe(false);
      expect(pressKey({ key: 'y' }).defaultPrevented).toBe(false);

      expect(undo).not.toHaveBeenCalled();
      expect(redo).not.toHaveBeenCalled();
    });

    it('入力欄での Ctrl+Z はストアの undo を呼ばない（入力欄自身の取り消しに任せる）', () => {
      const { undo } = withSpies();
      render(
        <>
          <Toolbar />
          <input aria-label="名前" />
        </>
      );

      expect(pressKey({ key: 'z', ctrlKey: true }, screen.getByLabelText('名前')).defaultPrevented).toBe(false);
      expect(undo).not.toHaveBeenCalled();
    });

    it('履歴がない（historyIndex = -1）ときは両方とも無効', () => {
      render(<Toolbar />);
      const { undo, redo } = getToolbarButtons();

      expect(store().historyIndex).toBe(-1);
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(true);
    });

    it('履歴が 1 件だけ（historyIndex = 0）でも元に戻すは有効', () => {
      useEditorStore.setState({ history: [EMPTY_ENTRY], historyIndex: 0 });
      render(<Toolbar />);
      const { undo, redo } = getToolbarButtons();

      expect(undo.disabled).toBe(false);
      expect(redo.disabled).toBe(true);
    });

    it('最新より前の位置にいるときは、元に戻す・やり直しの両方が有効', () => {
      useEditorStore.setState({ history: [EMPTY_ENTRY, EMPTY_ENTRY, EMPTY_ENTRY], historyIndex: 1 });
      render(<Toolbar />);
      const { undo, redo } = getToolbarButtons();

      expect(undo.disabled).toBe(false);
      expect(redo.disabled).toBe(false);
    });

    it('ボタンで 1 件戻して・やり直すと、有効/無効が追従する', async () => {
      useEditorStore.setState({ history: [EMPTY_ENTRY], historyIndex: 0 });
      const user = userEvent.setup();
      render(<Toolbar />);

      await user.click(getToolbarButtons().undo);
      expect(store().historyIndex).toBe(-1);
      expect(getToolbarButtons().undo.disabled).toBe(true);
      expect(getToolbarButtons().redo.disabled).toBe(false);

      await user.click(getToolbarButtons().redo);
      expect(store().historyIndex).toBe(0);
      expect(getToolbarButtons().undo.disabled).toBe(false);
      expect(getToolbarButtons().redo.disabled).toBe(true);
    });

    it('元に戻す・やり直しボタンのツールチップにショートカットが表示される', async () => {
      useEditorStore.setState({ history: [EMPTY_ENTRY, EMPTY_ENTRY], historyIndex: 0 });
      const user = userEvent.setup();
      render(<Toolbar />);

      expect(await tooltipTextOnHover(user, getToolbarButtons().undo)).toBe('元に戻す (Ctrl/⌘+Z)');
      expect(await tooltipTextOnHover(user, getToolbarButtons().redo)).toBe('やり直し (Ctrl/⌘+Y)');
    });
  });

  it('アンマウント後はショートカットに反応しない', () => {
    const { unmount } = render(<Toolbar />);
    unmount();

    expect(pressKey({ key: 'e' }).defaultPrevented).toBe(false);
    expect(store().activeTool).toBe('pencil');
  });
});

describe('Toolbar: 描画カラー', () => {
  const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };

  it('レイヤーがないときは描画カラーのボタンを表示し、背景に現在の色を反映する', () => {
    useEditorStore.setState({ drawingColor: RED });
    render(<Toolbar />);

    const button = queryColorButton();
    expect(button).not.toBeNull();
    expect(button!.style.backgroundColor).toBe('rgb(255, 0, 0)');
  });

  it('選択中のレイヤーが単色モードのときは表示せず、直接描画モードなら表示する', () => {
    render(<Toolbar />);

    act(() => {
      store().createLayer('単色', RED, 'singleColor');
    });
    expect(queryColorButton()).toBeNull();

    act(() => {
      store().createLayer('直接', RED, 'direct');
    });
    expect(store().layers.find((l) => l.id === store().activeLayerId)?.layerType).toBe('direct');
    expect(queryColorButton()).not.toBeNull();
  });

  it('ポップオーバーで HEX を入力すると描画カラーが変わる', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(queryColorButton()!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('描画カラー').length).toBeGreaterThan(0);

    const hexInput = within(dialog).getByPlaceholderText('#000000');
    await user.clear(hexInput);
    await user.type(hexInput, '#12ab34');

    expect(store().drawingColor).toEqual({ r: 0x12, g: 0xab, b: 0x34, a: 255 });
    expect(queryColorButton()!.style.backgroundColor).toBe('rgb(18, 171, 52)');
  });

  it('ポップオーバーの HEX 入力中に打ったキーではツールが切り替わらない', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);

    await user.click(queryColorButton()!);
    const hexInput = within(await screen.findByRole('dialog')).getByPlaceholderText('#000000');
    await user.clear(hexInput);
    await user.type(hexInput, 'e');

    expect(store().activeTool).toBe('pencil');
  });
});
