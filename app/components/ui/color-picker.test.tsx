// @vitest-environment jsdom
// ColorPicker（HSV ピッカー・HEX 入力・パレット）のテスト
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// Web Worker を起動しないよう PixelEngine をモックに差し替える
vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { ColorPicker } from './color-picker';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { useEditorStore } from '../../stores/editorStore';
import type { RGBA } from '../../types/editor';

// ---- jsdom に無い API の最小スタブ ----
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.setPointerCapture ??= function setPointerCapture() {};
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false;
};

// ---- テスト用の色 ----
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

// ---- テスト用ヘルパー ----

const store = () => useEditorStore.getState();

type PickerProps = Partial<React.ComponentProps<typeof ColorPicker>>;

function renderPicker(props: PickerProps = {}) {
  const onChange = vi.fn<(c: RGBA) => void>();
  const onChangeComplete = vi.fn<() => void>();
  const allProps = { color: RED, onChange, onChangeComplete, ...props };
  const utils = render(<ColorPicker {...allProps} />);
  const rerenderWith = (next: PickerProps) => utils.rerender(<ColorPicker {...allProps} {...next} />);
  return { ...utils, onChange, onChangeComplete, rerenderWith };
}

// onChange の結果を color に反映する（実際の使われ方と同じ制御コンポーネント）。
// 「外部から色を変える」ボタンも用意する（スポイトや undo による変更の代わり）
function StatefulPicker({
  initial,
  external,
  onChange,
  onChangeComplete,
  showAlpha,
}: {
  initial: RGBA;
  external?: RGBA;
  onChange?: (c: RGBA) => void;
  onChangeComplete?: () => void;
  showAlpha?: boolean;
}) {
  const [color, setColor] = useState(initial);
  return (
    <>
      <ColorPicker
        color={color}
        onChange={(c) => {
          setColor(c);
          onChange?.(c);
        }}
        onChangeComplete={onChangeComplete}
        showAlpha={showAlpha}
      />
      {external && (
        <button type="button" onClick={() => setColor(external)}>
          外部から変更
        </button>
      )}
      <output aria-label="現在の色">{JSON.stringify(color)}</output>
    </>
  );
}

const currentColorOf = () => JSON.parse(screen.getByLabelText('現在の色').textContent!) as RGBA;

const getHexInput = () => screen.getByPlaceholderText<HTMLInputElement>('#000000');

// 彩度・明度エリア（十字カーソルの 2D グラデーション）。ロールやラベルがないため見た目の特徴で探す
function getSaturationValueArea(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>('.cursor-crosshair');
  if (!el) throw new Error('彩度・明度エリアが見つかりません');
  return el;
}

// 「Hue」「Alpha (…)」ラベルの直後にあるスライダー
const getHueSlider = () => screen.getByText('Hue').nextElementSibling as HTMLElement;
const getAlphaSlider = () => screen.getByText(/^Alpha/).nextElementSibling as HTMLElement;

// jsdom はレイアウトしないので、要素の位置と大きさを決め打ちする
function mockRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect);
}

const pointer = {
  down: (el: HTMLElement, clientX: number, clientY = 0) => fireEvent.pointerDown(el, { clientX, clientY, pointerId: 1 }),
  move: (el: HTMLElement, clientX: number, clientY = 0) => fireEvent.pointerMove(el, { clientX, clientY, pointerId: 1 }),
  up: (el: HTMLElement, clientX = 0, clientY = 0) => fireEvent.pointerUp(el, { clientX, clientY, pointerId: 1 }),
  cancel: (el: HTMLElement) => fireEvent.pointerCancel(el, { pointerId: 1 }),
};

// パレット見出しの横の「現在の色をパレットに追加」ボタン（アイコンのみ）
const getAddButton = () => within(screen.getByText('パレット').parentElement!).getByRole('button');
const queryNameInput = () => screen.queryByRole<HTMLInputElement>('textbox', { name: '色の名前' });
const getNameInput = () => screen.getByRole<HTMLInputElement>('textbox', { name: '色の名前' });

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
});

describe('ColorPicker: HEX 入力', () => {
  it('現在の色を小文字の #rrggbb で表示する', () => {
    renderPicker({ color: { r: 0xab, g: 0x0c, b: 0xef, a: 255 } });
    expect(getHexInput().value).toBe('#ab0cef');
  });

  it('正しい 6 桁の HEX を入力すると onChange と onChangeComplete を 1 回ずつ呼ぶ', async () => {
    const user = userEvent.setup();
    const { onChange, onChangeComplete } = renderPicker();

    await user.clear(getHexInput());
    await user.type(getHexInput(), '#12ab34');

    // 入力途中（#, #1, … #12ab3）では確定しない
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ r: 0x12, g: 0xab, b: 0x34, a: 255 });
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
    expect(getHexInput().value).toBe('#12ab34');
  });

  it('大文字の HEX も受け付ける', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.clear(getHexInput());
    await user.type(getHexInput(), '#00FF7F');

    expect(onChange).toHaveBeenCalledWith({ r: 0, g: 255, b: 0x7f, a: 255 });
  });

  it('HEX から色を変えても、現在の不透明度（アルファ）は保つ', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ color: { ...RED, a: 77 } });

    await user.clear(getHexInput());
    await user.type(getHexInput(), '#0000ff');

    expect(onChange).toHaveBeenCalledWith({ r: 0, g: 0, b: 255, a: 77 });
  });

  it.each(['#12ab3', '#12ab345', '#gg0000', '#12 ab3', ''])('不正な値 "%s" では色を変えず、入力内容だけ保持する', async (text) => {
    const user = userEvent.setup();
    const { onChange, onChangeComplete } = renderPicker();

    // 途中の文字列を経由しないよう、貼り付けで一度に入力する
    await user.clear(getHexInput());
    if (text) await user.paste(text);

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeComplete).not.toHaveBeenCalled();
    expect(getHexInput().value).toBe(text);
  });

  it('HEX で変えた色は彩度・明度エリアの操作の基準にもなる', async () => {
    const user = userEvent.setup();
    const { container, onChange } = renderPicker({ color: RED });

    await user.clear(getHexInput());
    await user.type(getHexInput(), '#0000ff');
    onChange.mockClear();

    // 右上（彩度・明度とも最大）をクリックすると、HEX で選んだ色相（青）の純色になる
    const area = getSaturationValueArea(container);
    mockRect(area, { left: 0, top: 0, width: 100, height: 100 });
    pointer.down(area, 100, 0);
    pointer.up(area);

    expect(onChange).toHaveBeenLastCalledWith(BLUE);
  });

  it('外部から color が変わると HEX 表示も更新する', () => {
    const { rerenderWith } = renderPicker({ color: RED });
    expect(getHexInput().value).toBe('#ff0000');

    rerenderWith({ color: { r: 1, g: 2, b: 3, a: 255 } });
    expect(getHexInput().value).toBe('#010203');
  });

  it('外部から color が変わると、以降の操作もその色（色相）を基準にする', () => {
    const { container, onChange, rerenderWith } = renderPicker({ color: RED });
    rerenderWith({ color: BLUE });

    const area = getSaturationValueArea(container);
    mockRect(area, { left: 0, top: 0, width: 100, height: 100 });
    pointer.down(area, 100, 0);
    pointer.up(area);

    expect(onChange).toHaveBeenLastCalledWith(BLUE);
  });
});

describe('ColorPicker: 彩度・明度エリアのドラッグ', () => {
  function setup(props: PickerProps = {}) {
    const utils = renderPicker(props);
    const area = getSaturationValueArea(utils.container);
    mockRect(area, { left: 10, top: 20, width: 100, height: 100 });
    return { ...utils, area };
  }

  it('押下・移動のたびに onChange を呼び、onChangeComplete は離したときに 1 回だけ呼ぶ', () => {
    const { area, onChange, onChangeComplete } = setup({ color: RED });

    // (x, y) = (50%, 25%) → 彩度 50, 明度 75
    pointer.down(area, 60, 45);
    expect(onChange).toHaveBeenLastCalledWith({ r: 191, g: 96, b: 96, a: 255 });

    // 右上 → 彩度 100, 明度 100（純色）
    pointer.move(area, 110, 20);
    expect(onChange).toHaveBeenLastCalledWith(RED);

    // 左下 → 明度 0（黒）
    pointer.move(area, 10, 120);
    expect(onChange).toHaveBeenLastCalledWith({ r: 0, g: 0, b: 0, a: 255 });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChangeComplete).not.toHaveBeenCalled();

    pointer.up(area, 10, 120);
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('エリアの外にはみ出した位置は端に丸める', () => {
    const { area, onChange } = setup({ color: RED });

    pointer.down(area, -500, -500); // 左上の外 → 彩度 0, 明度 100（白）
    expect(onChange).toHaveBeenLastCalledWith({ r: 255, g: 255, b: 255, a: 255 });

    pointer.move(area, 9999, 9999); // 右下の外 → 明度 0（黒）
    expect(onChange).toHaveBeenLastCalledWith({ r: 0, g: 0, b: 0, a: 255 });

    pointer.move(area, 9999, -9999); // 右上の外 → 純色
    expect(onChange).toHaveBeenLastCalledWith(RED);
  });

  it('色を変えても現在のアルファは保つ', () => {
    const { area, onChange } = setup({ color: { ...GREEN, a: 10 } });

    pointer.down(area, 110, 20);
    expect(onChange).toHaveBeenLastCalledWith({ ...GREEN, a: 10 });
  });

  it('押していない状態での移動・離す操作は無視する', () => {
    const { area, onChange, onChangeComplete } = setup();

    pointer.move(area, 50, 50);
    pointer.up(area, 50, 50);

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeComplete).not.toHaveBeenCalled();
  });

  it('ドラッグ終了後の移動では色を変えず、2 回目の pointerup でも onChangeComplete を重複して呼ばない', () => {
    const { area, onChange, onChangeComplete } = setup();

    pointer.down(area, 50, 50);
    pointer.up(area, 50, 50);
    pointer.move(area, 80, 80);
    pointer.up(area, 80, 80);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
  });

  it('ドラッグのたびに onChangeComplete を 1 回ずつ呼ぶ', () => {
    const { area, onChangeComplete } = setup();

    for (let i = 0; i < 3; i++) {
      pointer.down(area, 50, 50);
      pointer.move(area, 60, 60);
      pointer.up(area, 60, 60);
    }

    expect(onChangeComplete).toHaveBeenCalledTimes(3);
  });

  it('pointercancel でもドラッグを終了し、onChangeComplete を 1 回呼ぶ', () => {
    const { area, onChange, onChangeComplete } = setup();

    pointer.down(area, 50, 50);
    pointer.cancel(area);
    pointer.move(area, 80, 80);

    expect(onChangeComplete).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ドラッグ中はポインタをキャプチャし、終了時に解放する（エリア外に出てもドラッグが続くように）', () => {
    const { area } = setup();
    const capture = vi.spyOn(area, 'setPointerCapture');
    const release = vi.spyOn(area, 'releasePointerCapture');

    pointer.down(area, 50, 50);
    expect(capture).toHaveBeenCalledWith(1);
    expect(release).not.toHaveBeenCalled();

    pointer.up(area, 50, 50);
    expect(release).toHaveBeenCalledWith(1);
  });

  it('onChangeComplete を渡さなくても動作する', () => {
    const { area, onChange } = setup({ onChangeComplete: undefined });

    pointer.down(area, 50, 50);
    expect(() => pointer.up(area, 50, 50)).not.toThrow();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ドラッグ中に onChangeComplete が差し替わったら、新しい方を呼ぶ', () => {
    const { area, onChangeComplete, rerenderWith } = setup();
    const next = vi.fn();

    pointer.down(area, 50, 50);
    rerenderWith({ onChangeComplete: next });
    pointer.up(area, 50, 50);

    expect(next).toHaveBeenCalledTimes(1);
    expect(onChangeComplete).not.toHaveBeenCalled();
  });

  describe('ドラッグ中のアンマウント', () => {
    it('ドラッグ中にアンマウントされても onChangeComplete を 1 回だけ呼ぶ（履歴の確定漏れ防止）', () => {
      const { area, onChange, onChangeComplete, unmount } = setup();

      pointer.down(area, 50, 50);
      pointer.move(area, 70, 70);
      expect(onChangeComplete).not.toHaveBeenCalled();

      unmount();

      expect(onChangeComplete).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('ドラッグしていなければ、アンマウントしても onChangeComplete を呼ばない', () => {
      const { area, onChangeComplete, unmount } = setup();

      pointer.down(area, 50, 50);
      pointer.up(area, 50, 50);
      expect(onChangeComplete).toHaveBeenCalledTimes(1);

      unmount();
      expect(onChangeComplete).toHaveBeenCalledTimes(1);
    });

    it('一度もドラッグせずにアンマウントしても onChangeComplete を呼ばない', () => {
      const { onChangeComplete, unmount } = setup();
      unmount();
      expect(onChangeComplete).not.toHaveBeenCalled();
    });

    it('ドラッグ中にポップオーバーが閉じても（中身のアンマウント）onChangeComplete を 1 回呼ぶ', async () => {
      const onChangeComplete = vi.fn();
      const user = userEvent.setup();
      function Harness() {
        const [open, setOpen] = useState(true);
        return (
          <>
            <button type="button" onClick={() => setOpen(false)}>
              閉じる
            </button>
            <Popover open={open}>
              <PopoverTrigger>開く</PopoverTrigger>
              <PopoverContent>
                <ColorPicker color={RED} onChange={() => {}} onChangeComplete={onChangeComplete} />
              </PopoverContent>
            </Popover>
          </>
        );
      }
      render(<Harness />);
      const area = getSaturationValueArea(await screen.findByRole('dialog'));
      mockRect(area, { left: 0, top: 0, width: 100, height: 100 });

      pointer.down(area, 50, 50);
      await user.click(screen.getByRole('button', { name: '閉じる' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(onChangeComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('無彩色（彩度 0）を経由しても色相を保つ', () => {
    const onChange = vi.fn();
    const { container } = render(<StatefulPicker initial={GREEN} onChange={onChange} />);
    const area = getSaturationValueArea(container);
    mockRect(area, { left: 0, top: 0, width: 100, height: 100 });

    // 左上（彩度 0）→ 白。RGB からは色相が分からなくなる
    pointer.down(area, 0, 0);
    pointer.up(area);
    expect(currentColorOf()).toEqual({ r: 255, g: 255, b: 255, a: 255 });

    // 右上（彩度 100）→ 元の色相（緑）の純色に戻る
    pointer.down(area, 100, 0);
    pointer.up(area);
    expect(currentColorOf()).toEqual(GREEN);
  });
});

describe('ColorPicker: 色相スライダー', () => {
  it('横位置に応じて色相を変え、彩度・明度は保つ', () => {
    const { onChange, onChangeComplete } = renderPicker({ color: RED });
    const hue = getHueSlider();
    mockRect(hue, { left: 0, top: 0, width: 360, height: 16 });

    pointer.down(hue, 120, 8); // 120° → 緑
    expect(onChange).toHaveBeenLastCalledWith(GREEN);

    pointer.move(hue, 240, 8); // 240° → 青
    expect(onChange).toHaveBeenLastCalledWith(BLUE);

    pointer.move(hue, 9999, 8); // 右端（360°）→ 赤に戻る
    expect(onChange).toHaveBeenLastCalledWith(RED);

    expect(onChangeComplete).not.toHaveBeenCalled();
    pointer.up(hue);
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
  });

  it('暗い色では明度を保ったまま色相だけ変わる', () => {
    const { onChange } = renderPicker({ color: { r: 128, g: 0, b: 0, a: 255 } });
    const hue = getHueSlider();
    mockRect(hue, { left: 0, top: 0, width: 360, height: 16 });

    pointer.down(hue, 240, 8);
    expect(onChange).toHaveBeenLastCalledWith({ r: 0, g: 0, b: 128, a: 255 });
  });

  it('ドラッグ中にアンマウントされても onChangeComplete を 1 回呼ぶ', () => {
    const { onChangeComplete, unmount } = renderPicker();
    const hue = getHueSlider();
    mockRect(hue, { left: 0, top: 0, width: 360, height: 16 });

    pointer.down(hue, 100, 8);
    unmount();

    expect(onChangeComplete).toHaveBeenCalledTimes(1);
  });
});

describe('ColorPicker: アルファスライダー', () => {
  it('showAlpha を指定しないときは表示しない', () => {
    renderPicker();
    expect(screen.queryByText(/^Alpha/)).toBeNull();
  });

  it('現在のアルファを % で表示する', () => {
    renderPicker({ color: { ...RED, a: 64 }, showAlpha: true });
    expect(screen.getByText('Alpha (25%)')).toBeTruthy();
  });

  it('横位置に応じてアルファだけを変える（0〜255 に丸める）', () => {
    const { onChange, onChangeComplete } = renderPicker({ color: { r: 10, g: 20, b: 30, a: 255 }, showAlpha: true });
    const alpha = getAlphaSlider();
    mockRect(alpha, { left: 0, top: 0, width: 200, height: 16 });

    pointer.down(alpha, 100, 8);
    expect(onChange).toHaveBeenLastCalledWith({ r: 10, g: 20, b: 30, a: 128 });

    pointer.move(alpha, -50, 8);
    expect(onChange).toHaveBeenLastCalledWith({ r: 10, g: 20, b: 30, a: 0 });

    pointer.move(alpha, 500, 8);
    expect(onChange).toHaveBeenLastCalledWith({ r: 10, g: 20, b: 30, a: 255 });

    pointer.up(alpha);
    expect(onChangeComplete).toHaveBeenCalledTimes(1);
  });

  it('アルファを変えると表示中の % も更新される（制御コンポーネント）', () => {
    render(<StatefulPicker initial={RED} showAlpha />);
    const alpha = getAlphaSlider();
    mockRect(alpha, { left: 0, top: 0, width: 100, height: 16 });

    pointer.down(alpha, 50, 8);
    pointer.up(alpha);

    expect(currentColorOf()).toEqual({ ...RED, a: 128 });
    expect(screen.getByText('Alpha (50%)')).toBeTruthy();
  });
});

describe('ColorPicker: パレット', () => {
  it('showPalette={false} のときはパレットを表示しない', () => {
    renderPicker({ showPalette: false });
    expect(screen.queryByText('パレット')).toBeNull();
  });

  it('パレットが空なら案内を表示する', () => {
    renderPicker();
    expect(screen.getByText('+ボタンで色を保存')).toBeTruthy();
  });

  it('追加ボタンのツールチップに説明を表示する', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.hover(getAddButton());
    expect((await screen.findByRole('tooltip')).textContent).toBe('現在の色をパレットに追加');
  });

  describe('追加と名前の入力', () => {
    it('追加ボタンで現在の色を保存し、名前の入力欄にフォーカスする', async () => {
      const user = userEvent.setup();
      renderPicker({ color: { r: 1, g: 2, b: 3, a: 200 } });

      await user.click(getAddButton());

      expect(store().palette).toHaveLength(1);
      expect(store().palette[0].color).toEqual({ r: 1, g: 2, b: 3, a: 200 });
      expect(store().palette[0].name).toBeUndefined();

      const input = getNameInput();
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('');
      expect(input.placeholder).toBe('名前（#010203）');
      expect(screen.queryByText('+ボタンで色を保存')).toBeNull();
    });

    it('Enter で名前を保存して入力欄を閉じ、スウォッチのラベルに名前が付く', async () => {
      const user = userEvent.setup();
      renderPicker({ color: RED });

      await user.click(getAddButton());
      await user.type(getNameInput(), '肌の影{Enter}');

      expect(store().palette[0].name).toBe('肌の影');
      expect(queryNameInput()).toBeNull();
      expect(screen.getByRole('button', { name: '肌の影（#ff0000）' })).toBeTruthy();
    });

    it('前後の空白は取り除いて保存する', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.click(getAddButton());
      await user.type(getNameInput(), '  髪  {Enter}');

      expect(store().palette[0].name).toBe('髪');
    });

    it('空のまま Enter すると名前なしで保存する（色の追加自体は残る）', async () => {
      const user = userEvent.setup();
      renderPicker({ color: RED });

      await user.click(getAddButton());
      await user.keyboard('{Enter}');

      expect(queryNameInput()).toBeNull();
      expect(store().palette).toHaveLength(1);
      expect(store().palette[0].name).toBeUndefined();
      expect(screen.getByRole('button', { name: '#ff0000' })).toBeTruthy();
    });

    it('フォーカスが外れたときも入力中の名前を保存する', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.click(getAddButton());
      await user.type(getNameInput(), '目');
      await user.click(getHexInput());

      expect(store().palette[0].name).toBe('目');
      expect(queryNameInput()).toBeNull();
    });

    it('名前は 32 文字までしか入力できない', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.click(getAddButton());
      await user.type(getNameInput(), 'a'.repeat(40));

      expect(getNameInput().value).toHaveLength(32);
    });

    it('Esc で入力を取り消す: 入力欄を閉じ、名前は保存せず、キーイベントは preventDefault する', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.click(getAddButton());
      await user.type(getNameInput(), '取り消す名前');

      const notCanceled = fireEvent.keyDown(getNameInput(), { key: 'Escape' });

      expect(notCanceled).toBe(false);
      expect(queryNameInput()).toBeNull();
      expect(store().palette).toHaveLength(1);
      expect(store().palette[0].name).toBeUndefined();
    });

    it('Esc で取り消しても、既存の名前は変わらない', async () => {
      useEditorStore.setState({ palette: [{ id: 'p1', color: RED, name: '元の名前' }] });
      const user = userEvent.setup();
      renderPicker();

      await user.dblClick(screen.getByRole('button', { name: '元の名前（#ff0000）' }));
      await user.clear(getNameInput());
      await user.type(getNameInput(), '新しい名前');
      await user.keyboard('{Escape}');

      expect(queryNameInput()).toBeNull();
      expect(store().palette[0].name).toBe('元の名前');
    });

    it('名前の入力中でなければ Esc を止めない', () => {
      renderPicker();
      expect(fireEvent.keyDown(getHexInput(), { key: 'Escape' })).toBe(true);
    });

    describe('ポップオーバー内で使う場合', () => {
      function renderInPopover() {
        const onOpenChange = vi.fn();
        function Harness() {
          const [open, setOpen] = useState(true);
          return (
            <Popover
              open={open}
              onOpenChange={(next) => {
                onOpenChange(next);
                setOpen(next);
              }}
            >
              <PopoverTrigger>開く</PopoverTrigger>
              <PopoverContent>
                <ColorPicker color={RED} onChange={() => {}} />
              </PopoverContent>
            </Popover>
          );
        }
        render(<Harness />);
        return { onOpenChange };
      }

      it('名前入力中の Esc は入力の取り消しだけで、ポップオーバーは閉じない', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderInPopover();
        const dialog = await screen.findByRole('dialog');

        await user.click(within(dialog).getByText('パレット').parentElement!.querySelector('button')!);
        await user.type(getNameInput(), '途中');
        expect(document.activeElement).toBe(getNameInput());

        await user.keyboard('{Escape}');

        expect(queryNameInput()).toBeNull();
        expect(screen.queryByRole('dialog')).not.toBeNull();
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(store().palette[0].name).toBeUndefined();
      });

      it('名前入力中でなければ Esc でポップオーバーが閉じる', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderInPopover();
        const dialog = await screen.findByRole('dialog');

        await user.click(within(dialog).getByPlaceholderText('#000000'));
        await user.keyboard('{Escape}');

        expect(onOpenChange).toHaveBeenCalledWith(false);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      });

      it('Esc で名前入力を取り消したあと、もう一度 Esc を押すとポップオーバーが閉じる', async () => {
        const user = userEvent.setup();
        const { onOpenChange } = renderInPopover();
        const dialog = await screen.findByRole('dialog');

        await user.click(within(dialog).getByText('パレット').parentElement!.querySelector('button')!);
        fireEvent.keyDown(getNameInput(), { key: 'Escape' });
        expect(queryNameInput()).toBeNull();
        expect(onOpenChange).not.toHaveBeenCalled();

        fireEvent.keyDown(within(dialog).getByPlaceholderText('#000000'), { key: 'Escape' });
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  describe('保存済みの色', () => {
    const SAVED = [
      { id: 'p1', color: { r: 0x11, g: 0x22, b: 0x33, a: 255 }, name: '影' },
      { id: 'p2', color: { r: 0xaa, g: 0xbb, b: 0xcc, a: 128 } },
    ];

    beforeEach(() => {
      useEditorStore.setState({ palette: SAVED.map((p) => ({ ...p, color: { ...p.color } })) });
    });

    // ホバー中にだけ出る小さなボタンを押す。
    // user-event のポインタ移動は relatedTarget を設定しないため、React からは「ウィンドウ外へ出た」
    // （= ホバー解除）に見えてボタンが消えてしまう。移動を伴わない click で押す
    function clickOverlayButton(name: string) {
      fireEvent.click(screen.getByRole('button', { name }));
    }

    it('名前付きは「名前（HEX）」、名前なしは HEX をラベルにしてスウォッチを並べる', () => {
      renderPicker();

      expect(screen.getByRole('button', { name: '影（#112233）' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '#aabbcc' })).toBeTruthy();
      expect(screen.queryByText('+ボタンで色を保存')).toBeNull();
    });

    it('スウォッチのクリックでその色（アルファ含む）を選び、onChangeComplete を 1 回呼ぶ', async () => {
      const user = userEvent.setup();
      const { onChange, onChangeComplete } = renderPicker({ color: RED });

      await user.click(screen.getByRole('button', { name: '#aabbcc' }));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ r: 0xaa, g: 0xbb, b: 0xcc, a: 128 });
      // ストア内のオブジェクトをそのまま渡さない
      expect(onChange.mock.calls[0][0]).not.toBe(store().palette[1].color);
      expect(onChangeComplete).toHaveBeenCalledTimes(1);
      expect(getHexInput().value).toBe('#aabbcc');
    });

    it('ホバーで削除ボタンが現れ、押すとその色だけパレットから消える（色は選択しない）', async () => {
      const user = userEvent.setup();
      const { onChange } = renderPicker();
      expect(screen.queryByRole('button', { name: 'パレットから削除' })).toBeNull();

      await user.hover(screen.getByRole('button', { name: '影（#112233）' }));
      clickOverlayButton('パレットから削除');

      expect(store().palette.map((p) => p.id)).toEqual(['p2']);
      expect(screen.queryByRole('button', { name: '影（#112233）' })).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('ホバーで出る「名前を編集」から、現在の名前を初期値として編集できる', async () => {
      const user = userEvent.setup();
      const { onChange } = renderPicker();

      await user.hover(screen.getByRole('button', { name: '影（#112233）' }));
      clickOverlayButton('名前を編集');

      const input = getNameInput();
      expect(input.value).toBe('影');
      expect(input.placeholder).toBe('名前（#112233）');

      await user.clear(input);
      await user.type(input, '濃い影{Enter}');

      expect(store().palette.find((p) => p.id === 'p1')?.name).toBe('濃い影');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('ダブルクリックでも名前を編集できる', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.dblClick(screen.getByRole('button', { name: '#aabbcc' }));
      await user.type(getNameInput(), '空{Enter}');

      expect(store().palette.find((p) => p.id === 'p2')?.name).toBe('空');
      expect(screen.getByRole('button', { name: '空（#aabbcc）' })).toBeTruthy();
    });

    it('名前を空にして確定すると名前を消す', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.dblClick(screen.getByRole('button', { name: '影（#112233）' }));
      await user.clear(getNameInput());
      await user.keyboard('{Enter}');

      expect(store().palette.find((p) => p.id === 'p1')?.name).toBeUndefined();
      expect(screen.getByRole('button', { name: '#112233' })).toBeTruthy();
    });

    it('空白だけの名前も名前なしとして扱う', async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.dblClick(screen.getByRole('button', { name: '影（#112233）' }));
      await user.clear(getNameInput());
      await user.type(getNameInput(), '   {Enter}');

      expect(store().palette.find((p) => p.id === 'p1')?.name).toBeUndefined();
    });

    it('編集中に別の色を追加すると、編集中の名前を確定してから新しい色の名前入力に移る', async () => {
      const user = userEvent.setup();
      renderPicker({ color: RED });

      await user.dblClick(screen.getByRole('button', { name: '#aabbcc' }));
      await user.type(getNameInput(), '空');
      await user.click(getAddButton());

      expect(store().palette.find((p) => p.id === 'p2')?.name).toBe('空');
      expect(store().palette).toHaveLength(3);
      expect(getNameInput().value).toBe('');
      expect(getNameInput().placeholder).toBe('名前（#ff0000）');
    });
  });
});

describe('ColorPicker: 外部からの色の変更への追従', () => {
  it('HEX 欄で今と同じ色を入力し直した後でも、外部からの変更が表示に反映される', () => {
    render(<StatefulPicker initial={RED} external={BLUE} />);
    // 途中まで消してから同じ色を打ち直す
    fireEvent.change(getHexInput(), { target: { value: '#ff00' } });
    fireEvent.change(getHexInput(), { target: { value: '#ff0000' } });
    expect(currentColorOf()).toEqual(RED);

    fireEvent.click(screen.getByRole('button', { name: '外部から変更' }));

    expect(getHexInput().value).toBe('#0000ff');
  });

  it('彩度・明度エリアで今と同じ色をクリックした後でも、外部からの変更の後のクリックは新しい色相で始まる', () => {
    const { container } = render(<StatefulPicker initial={RED} external={BLUE} />);
    const area = getSaturationValueArea(container);
    mockRect(area, { left: 0, top: 0, width: 100, height: 100 });
    // 右上（純色）= 今と同じ赤
    pointer.down(area, 100, 0);
    pointer.up(area, 100, 0);
    expect(currentColorOf()).toEqual(RED);

    fireEvent.click(screen.getByRole('button', { name: '外部から変更' }));
    expect(getHexInput().value).toBe('#0000ff');

    // 右上をクリック → 外部から設定された青の色相の純色（赤に戻らない）
    pointer.down(area, 100, 0);
    pointer.up(area, 100, 0);
    expect(currentColorOf()).toEqual(BLUE);
  });

  it('パレットで今と同じ色を選んだ後でも、外部からの変更が表示に反映される', () => {
    useEditorStore.setState({ palette: [{ id: 'p', color: { ...RED } }] });
    render(<StatefulPicker initial={RED} external={BLUE} />);
    fireEvent.click(screen.getByRole('button', { name: '#ff0000' }));

    fireEvent.click(screen.getByRole('button', { name: '外部から変更' }));

    expect(getHexInput().value).toBe('#0000ff');
  });

  it('自分のドラッグで黒にしても、色相スライダーの位置は保たれる（外部からの変更と区別する）', () => {
    const { container } = render(<StatefulPicker initial={BLUE} />);
    const area = getSaturationValueArea(container);
    mockRect(area, { left: 0, top: 0, width: 100, height: 100 });
    const hueThumbLeft = () => (getHueSlider().firstElementChild as HTMLElement).style.left;
    const before = hueThumbLeft();

    pointer.down(area, 50, 100); // 明度 0 → 黒（色相の情報は色からは失われる）
    pointer.up(area, 50, 100);

    expect(currentColorOf()).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(hueThumbLeft()).toBe(before);
  });
});
