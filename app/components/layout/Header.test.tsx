// @vitest-environment jsdom
// ヘッダーのプロジェクト（JSON）書き出し・読み込みのテスト
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { Header } from './Header';
import { useEditorStore } from '../../stores/editorStore';
import type { RGBA } from '../../types/editor';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
// テーマ（ダーク / ライト）の判定に使う
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 200 };
const s = () => useEditorStore.getState();

// JSON の書き出しボタン（ダウンロードアイコンのうち 2 つ目）で書き出された内容を取り出す
async function exportJson(container: HTMLElement): Promise<string> {
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const downloads = container.querySelectorAll('button:has(svg.lucide-download)');
  fireEvent.click(downloads[downloads.length - 1]);
  expect(blob).not.toBeNull();
  return await (blob as unknown as Blob).text();
}

async function importJson(container: HTMLElement, json: string) {
  const input = container.querySelector<HTMLInputElement>('input[accept="application/json,.json"]')!;
  const file = new File([json], 'project.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('プロジェクト（JSON）の書き出しと読み込み', () => {
  it('書き出した JSON を読み込み直すと、レイヤー・グループ・パレット・モデルが元どおりになる', async () => {
    const group = s().createLayerGroup('頭部');
    const a = s().createLayer('肌', RED, 'singleColor');
    s().setPixelRect(1, 1, 2, 1, RED);
    const b = s().createLayer('影', BLUE, 'direct');
    s().setPixelRect(3, 3, 3, 3, BLUE);
    s().moveLayerToGroup(b, group);
    s().updateLayerOpacity(a, 40);
    s().toggleLayerVisibility(b);
    s().addToPalette(RED, '赤');
    s().addToPalette(BLUE);
    s().setModelType('alex');
    const expected = {
      layers: structuredClone(s().layers),
      layerGroups: structuredClone(s().layerGroups),
      palette: structuredClone(s().palette),
    };

    const { container } = render(<Header />);
    const json = await exportJson(container);

    // 別の状態にしてから読み込む
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    await importJson(container, json);

    await waitFor(() => expect(s().layers).toHaveLength(2));
    const byId = <T extends { id: string }>(items: T[]) => [...items].sort((x, y) => x.id.localeCompare(y.id));
    // noiseSettings.material は書き出し時に null になる（未設定と同じ扱い）
    const normalize = (layers: typeof expected.layers) =>
      byId(layers).map((l) => ({ ...l, noiseSettings: { brightness: l.noiseSettings.brightness, hue: l.noiseSettings.hue } }));
    expect(normalize(s().layers)).toEqual(normalize(expected.layers));
    expect(byId(s().layerGroups)).toEqual(byId(expected.layerGroups));
    expect(s().palette).toEqual(expected.palette);
    expect(s().modelType).toBe('alex');
  });

  it('別のプロジェクトを読み込んだ後に元に戻しても、前のプロジェクトのレイヤーやグループが入り込まない', async () => {
    // 読み込むプロジェクトを用意して書き出す
    s().createLayer('読み込むレイヤー', RED, 'direct');
    s().setPixelRect(0, 0, 0, 0, RED);
    const { container } = render(<Header />);
    const json = await exportJson(container);
    const importedIds = s().layers.map((l) => l.id);

    // 前のプロジェクト: グループとレイヤーを作り、レイヤーを削除する構造の操作を履歴に残す
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    const group = s().createLayerGroup('前のグループ');
    const old = s().createLayer('前のレイヤー', BLUE, 'direct');
    s().setPixelRect(5, 5, 5, 5, BLUE);
    s().moveLayerToGroup(old, group);
    s().mergeLayersById(old, s().createLayer('統合先', RED, 'direct'));
    expect(s().history.length).toBeGreaterThan(0);

    await importJson(container, json);
    await waitFor(() => expect(s().layers.map((l) => l.id)).toEqual(importedIds));

    s().undo();
    s().undo();
    expect(s().layers.map((l) => l.id)).toEqual(importedIds);
    expect(s().layerGroups).toEqual([]);
  });
});

describe('Skin Crafter について', () => {
  it('タイトルをクリックすると、バージョンやショートカットを載せたダイアログが開き、Esc で閉じる', async () => {
    render(<Header />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Skin Crafter/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Skin Crafter' });
    const { version } = await import('../../../package.json');
    expect(within(dialog).getByText(`バージョン ${version.replace(/^v/, '')}`)).toBeTruthy();
    expect(within(dialog).getByText('ペンシル')).toBeTruthy();
    expect(within(dialog).getByText('Ctrl/⌘+Z')).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: /GitHub/ });
    expect(link.getAttribute('href')).toBe('https://github.com/bafv4/skin-crafter');
    expect(link.getAttribute('target')).toBe('_blank');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('狭い画面用の「ファイル」メニュー', () => {
  it('プロジェクトの書き出しとリセットの確認ダイアログを開ける', async () => {
    s().createLayer('肌', RED, 'singleColor');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<Header />);
    const openMenu = () =>
      fireEvent.pointerDown(screen.getByRole('button', { name: 'ファイル' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });

    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'プロジェクトを書き出す' }));
    expect(click).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'リセット' }));
    expect(await screen.findByRole('alertdialog', { name: '編集をリセット' })).toBeTruthy();
  });
});
