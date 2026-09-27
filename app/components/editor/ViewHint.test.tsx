// @vitest-environment jsdom
// ViewHint（ビュー下部の操作方法ヒント）のテスト
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewHint, type HintItem } from './ViewHint';

const ITEMS: HintItem[] = [
  { keys: ['左ドラッグ'], label: '回転' },
  { keys: ['右ドラッグ', 'Shift+ドラッグ'], label: '移動' },
  { keys: ['ホイール'], label: 'ズーム' },
];

const KEY = 'test-hint-3d';

const getNote = () => screen.getByRole('note', { name: '操作方法' });
const queryNote = () => screen.queryByRole('note', { name: '操作方法' });
const getHideButton = () => screen.getByRole('button', { name: '操作方法を隠す' });
const getShowButton = () => screen.getByRole('button', { name: '操作方法を表示' });
const queryShowButton = () => screen.queryByRole('button', { name: '操作方法を表示' });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ViewHint: 表示内容', () => {
  it('各項目のキーとラベルを一覧表示する', () => {
    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    const items = within(getNote()).getAllByRole('listitem');
    expect(items).toHaveLength(ITEMS.length);
    expect(items.map((li) => li.textContent)).toEqual([
      '左ドラッグ回転',
      '右ドラッグ/Shift+ドラッグ移動',
      'ホイールズーム',
    ]);
  });

  it('キーは <kbd> で表示し、複数キーの間にだけ区切りの「/」を入れる', () => {
    render(<ViewHint items={ITEMS} storageKey={KEY} />);
    const [, move] = within(getNote()).getAllByRole('listitem');

    const kbds = move.querySelectorAll('kbd');
    expect(Array.from(kbds, (k) => k.textContent)).toEqual(['右ドラッグ', 'Shift+ドラッグ']);
    expect(within(move).getAllByText('/')).toHaveLength(1);
    expect(within(move).getByText('移動')).toBeTruthy();
  });

  it('項目が空でも隠すボタンは表示される', () => {
    render(<ViewHint items={[]} storageKey={KEY} />);

    expect(within(getNote()).queryAllByRole('listitem')).toHaveLength(0);
    expect(getHideButton()).toBeTruthy();
  });

  it('保存済みの設定がなければ最初から表示する', () => {
    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    expect(queryNote()).not.toBeNull();
    expect(queryShowButton()).toBeNull();
  });
});

describe('ViewHint: 表示/非表示の切り替えと保存', () => {
  it('隠すボタンでヒントを隠し、localStorage に保存する', async () => {
    const user = userEvent.setup();
    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    await user.click(getHideButton());

    expect(queryNote()).toBeNull();
    expect(getShowButton()).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBe('hidden');
  });

  it('表示ボタンで元に戻し、保存していた設定を削除する', async () => {
    const user = userEvent.setup();
    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    await user.click(getHideButton());
    await user.click(getShowButton());

    expect(queryNote()).not.toBeNull();
    expect(within(getNote()).getAllByRole('listitem')).toHaveLength(ITEMS.length);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('隠した設定はマウントし直しても維持される', async () => {
    const user = userEvent.setup();
    const first = render(<ViewHint items={ITEMS} storageKey={KEY} />);
    await user.click(getHideButton());
    first.unmount();

    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    expect(queryNote()).toBeNull();
    expect(getShowButton()).toBeTruthy();
  });

  it('storageKey ごとに独立して保存される', async () => {
    const user = userEvent.setup();
    render(
      <>
        <div data-testid="2d">
          <ViewHint items={ITEMS} storageKey="hint-2d" />
        </div>
        <div data-testid="3d">
          <ViewHint items={ITEMS} storageKey="hint-3d" />
        </div>
      </>
    );

    await user.click(within(screen.getByTestId('2d')).getByRole('button', { name: '操作方法を隠す' }));

    expect(within(screen.getByTestId('2d')).queryByRole('note')).toBeNull();
    expect(within(screen.getByTestId('3d')).queryByRole('note')).not.toBeNull();
    expect(localStorage.getItem('hint-2d')).toBe('hidden');
    expect(localStorage.getItem('hint-3d')).toBeNull();
  });

  it('storageKey が変わると、そのキーの保存内容を読み直す', () => {
    localStorage.setItem('hint-b', 'hidden');
    const { rerender } = render(<ViewHint items={ITEMS} storageKey="hint-a" />);
    expect(queryNote()).not.toBeNull();

    rerender(<ViewHint items={ITEMS} storageKey="hint-b" />);
    expect(queryNote()).toBeNull();
    expect(getShowButton()).toBeTruthy();

    rerender(<ViewHint items={ITEMS} storageKey="hint-a" />);
    expect(queryNote()).not.toBeNull();
  });

  it("保存値が 'hidden' 以外なら表示する", () => {
    localStorage.setItem(KEY, 'visible');
    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    expect(queryNote()).not.toBeNull();
  });
});

describe('ViewHint: localStorage が使えない環境', () => {
  it('読み込みで例外が出ても表示状態で描画する', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    expect(queryNote()).not.toBeNull();
  });

  it('書き込みで例外が出ても表示の切り替えはできる', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    render(<ViewHint items={ITEMS} storageKey={KEY} />);

    await user.click(getHideButton());
    expect(setItem).toHaveBeenCalledWith(KEY, 'hidden');
    expect(queryNote()).toBeNull();

    await user.click(getShowButton());
    expect(removeItem).toHaveBeenCalledWith(KEY);
    expect(queryNote()).not.toBeNull();
  });
});
