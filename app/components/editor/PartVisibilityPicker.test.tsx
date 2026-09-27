// @vitest-environment jsdom
// PartVisibilityPicker（3D プレビューのパーツ別表示切り替え）のテスト
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// Web Worker を起動しないよう PixelEngine をモックに差し替える
vi.mock('../../lib/pixelEngine', () => import('../../test/pixelEngineMock'));

import { PartVisibilityPicker } from './PartVisibilityPicker';
import {
  BODY_PART_KEYS,
  createPartVisibility,
  type BodyPartKey,
  type PartVisibility,
} from './Preview3D.client';
import { useEditorStore } from '../../stores/editorStore';

// ---- テスト用ヘルパー ----

const PART_LABELS: Record<BodyPartKey, string> = {
  head: '頭',
  body: '胴体',
  rightArm: '右腕',
  leftArm: '左腕',
  rightLeg: '右足',
  leftLeg: '左足',
};

type LayerKind = 'inner' | 'outer';
const LAYER_LABELS: Record<LayerKind, string> = { inner: '内側', outer: '外側' };

// 図の中のパーツボタン（ラベルは「内側の頭を非表示」のように、押すと起こることを表す）
function getFigureButton(kind: LayerKind, part: BodyPartKey) {
  return screen.getByRole<HTMLButtonElement>('button', {
    name: new RegExp(`^${LAYER_LABELS[kind]}の${PART_LABELS[part]}を(表示|非表示)$`),
  });
}

function getFigureButtons(kind: LayerKind) {
  return BODY_PART_KEYS.map((part) => getFigureButton(kind, part));
}

// 「このパーツだけ表示」のボタン（ラベルはパーツ名そのもの）
function getShowOnlyButton(part: BodyPartKey) {
  return screen.getByRole('button', { name: PART_LABELS[part] });
}

function renderPicker(visibility: PartVisibility = createPartVisibility(true)) {
  const onChange = vi.fn<(v: PartVisibility) => void>();
  const utils = render(<PartVisibilityPicker visibility={visibility} onChange={onChange} />);
  return { ...utils, onChange };
}

// onChange の結果を反映する（実際の使われ方と同じ制御コンポーネント）
function StatefulPicker({ initial }: { initial: PartVisibility }) {
  const [visibility, setVisibility] = useState(initial);
  return <PartVisibilityPicker visibility={visibility} onChange={setVisibility} />;
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
});

describe('PartVisibilityPicker: 表示状態の反映', () => {
  it('内側・外側それぞれに 6 パーツのボタンを表示する', () => {
    renderPicker();

    expect(screen.getByText('内側（レイヤー1）')).toBeTruthy();
    expect(screen.getByText('外側（レイヤー2）')).toBeTruthy();
    for (const kind of ['inner', 'outer'] as const) {
      expect(getFigureButtons(kind)).toHaveLength(6);
    }
  });

  it('パーツごと・レイヤーごとの表示状態を aria-pressed とラベルに反映する', () => {
    const visibility = createPartVisibility(true);
    visibility.head = { inner: false, outer: true };
    visibility.leftLeg = { inner: true, outer: false };
    renderPicker(visibility);

    const head = getFigureButton('inner', 'head');
    expect(head.getAttribute('aria-pressed')).toBe('false');
    expect(head.getAttribute('aria-label')).toBe('内側の頭を表示');

    const headOuter = getFigureButton('outer', 'head');
    expect(headOuter.getAttribute('aria-pressed')).toBe('true');
    expect(headOuter.getAttribute('aria-label')).toBe('外側の頭を非表示');

    expect(getFigureButton('outer', 'leftLeg').getAttribute('aria-pressed')).toBe('false');
    expect(getFigureButton('inner', 'leftLeg').getAttribute('aria-pressed')).toBe('true');
    expect(getFigureButton('inner', 'body').getAttribute('aria-pressed')).toBe('true');
  });

  it('パーツボタンの title にパーツ名とレイヤーを表示する', () => {
    renderPicker();

    expect(getFigureButton('inner', 'rightArm').title).toBe('右腕（内側）');
    expect(getFigureButton('outer', 'leftLeg').title).toBe('左足（外側）');
  });
});

describe('PartVisibilityPicker: パーツのクリック', () => {
  it.each(BODY_PART_KEYS.flatMap((part) => (['inner', 'outer'] as const).map((kind) => [kind, part] as const)))(
    '%s の %s をクリックすると、そのパーツ・レイヤーだけが反転する',
    async (kind, part) => {
      const user = userEvent.setup();
      const visibility = createPartVisibility(true);
      const { onChange } = renderPicker(visibility);

      await user.click(getFigureButton(kind, part));

      expect(onChange).toHaveBeenCalledTimes(1);
      const expected = createPartVisibility(true);
      expected[part] = { ...expected[part], [kind]: false };
      expect(onChange.mock.calls[0][0]).toEqual(expected);
    }
  );

  it('非表示のパーツをクリックすると表示に戻す', async () => {
    const user = userEvent.setup();
    const visibility = createPartVisibility(false);
    const { onChange } = renderPicker(visibility);

    await user.click(getFigureButton('outer', 'body'));

    const expected = createPartVisibility(false);
    expected.body = { inner: false, outer: true };
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('渡された visibility オブジェクトは書き換えない', async () => {
    const user = userEvent.setup();
    const visibility = createPartVisibility(true);
    const snapshot = structuredClone(visibility);
    const { onChange } = renderPicker(visibility);

    await user.click(getFigureButton('inner', 'head'));
    await user.click(getShowOnlyButton('body'));
    await user.click(screen.getByRole('button', { name: 'すべて表示' }));

    expect(visibility).toEqual(snapshot);
    expect(onChange).toHaveBeenCalledTimes(3);
    for (const [next] of onChange.mock.calls) {
      expect(next).not.toBe(visibility);
    }
  });

  it('制御コンポーネントとして使うと、クリックのたびに表示が切り替わる', async () => {
    const user = userEvent.setup();
    render(<StatefulPicker initial={createPartVisibility(true)} />);

    await user.click(getFigureButton('inner', 'rightArm'));
    expect(getFigureButton('inner', 'rightArm').getAttribute('aria-pressed')).toBe('false');
    expect(getFigureButton('outer', 'rightArm').getAttribute('aria-pressed')).toBe('true');

    await user.click(getFigureButton('inner', 'rightArm'));
    expect(getFigureButton('inner', 'rightArm').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('PartVisibilityPicker: まとめて切り替え', () => {
  it('「このパーツだけ表示」の見出しとパーツ名のボタンを表示する', () => {
    renderPicker();

    expect(screen.getByText('このパーツだけ表示')).toBeTruthy();
    for (const part of BODY_PART_KEYS) {
      expect(getShowOnlyButton(part)).toBeTruthy();
    }
  });

  it.each(BODY_PART_KEYS)('%s だけ表示: そのパーツの内側・外側だけを表示にし、他はすべて非表示にする', async (part) => {
    const user = userEvent.setup();
    // 一部が非表示の状態から始めても結果は同じ
    const visibility = createPartVisibility(true);
    visibility[part] = { inner: false, outer: false };
    const { onChange } = renderPicker(visibility);

    await user.click(getShowOnlyButton(part));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    for (const key of BODY_PART_KEYS) {
      const visible = key === part;
      expect(next[key]).toEqual({ inner: visible, outer: visible });
    }
  });

  it('「すべて表示」で全パーツの内側・外側を表示にする', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker(createPartVisibility(false));

    await user.click(screen.getByRole('button', { name: 'すべて表示' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(createPartVisibility(true));
  });

  it('「このパーツだけ表示」のあと「すべて表示」で元に戻る（制御コンポーネント）', async () => {
    const user = userEvent.setup();
    render(<StatefulPicker initial={createPartVisibility(true)} />);

    await user.click(getShowOnlyButton('head'));
    expect(getFigureButtons('inner').map((b) => b.getAttribute('aria-pressed'))).toEqual(
      BODY_PART_KEYS.map((p) => String(p === 'head'))
    );
    expect(getFigureButtons('outer').map((b) => b.getAttribute('aria-pressed'))).toEqual(
      BODY_PART_KEYS.map((p) => String(p === 'head'))
    );

    await user.click(screen.getByRole('button', { name: 'すべて表示' }));
    for (const kind of ['inner', 'outer'] as const) {
      expect(getFigureButtons(kind).every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);
    }
  });
});

describe('PartVisibilityPicker: レイヤー2 の表示設定', () => {
  it('レイヤー2 がオンなら外側も操作でき、注意書きは出ない', () => {
    renderPicker();

    expect(getFigureButtons('outer').every((b) => !b.disabled)).toBe(true);
    expect(screen.queryByText('外側はレイヤー2の表示がオフのため無効です')).toBeNull();
  });

  it('レイヤー2 がオフなら外側のパーツは無効になり、注意書きを表示する', async () => {
    useEditorStore.setState({ showLayer2: false });
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    expect(getFigureButtons('outer').every((b) => b.disabled)).toBe(true);
    expect(getFigureButtons('inner').every((b) => !b.disabled)).toBe(true);
    expect(screen.getByText('外側はレイヤー2の表示がオフのため無効です')).toBeTruthy();

    await user.click(getFigureButton('outer', 'head'));
    expect(onChange).not.toHaveBeenCalled();

    // 内側・まとめて切り替えは引き続き使える
    await user.click(getFigureButton('inner', 'head'));
    await user.click(getShowOnlyButton('body'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ストアでレイヤー2 を切り替えると追従する', () => {
    renderPicker();
    expect(getFigureButton('outer', 'body').disabled).toBe(false);

    act(() => {
      useEditorStore.getState().toggleLayer2();
    });
    expect(getFigureButton('outer', 'body').disabled).toBe(true);

    act(() => {
      useEditorStore.getState().toggleLayer2();
    });
    expect(getFigureButton('outer', 'body').disabled).toBe(false);
    expect(screen.queryByText('外側はレイヤー2の表示がオフのため無効です')).toBeNull();
  });
});

describe('PartVisibilityPicker: モデルごとのパーツ配置', () => {
  // 1 スキンピクセル = 5px で描画する
  const px = (skinPixels: number) => `${skinPixels * 5}px`;

  it.each([
    ['steve', 4],
    ['alex', 3],
  ] as const)('%s: 腕の幅は %i ピクセル分で、他のパーツはその分ずれる', (modelType, armWidth) => {
    useEditorStore.setState({ modelType });
    renderPicker();

    for (const kind of ['inner', 'outer'] as const) {
      const rightArm = getFigureButton(kind, 'rightArm');
      const leftArm = getFigureButton(kind, 'leftArm');
      const head = getFigureButton(kind, 'head');
      const body = getFigureButton(kind, 'body');
      const rightLeg = getFigureButton(kind, 'rightLeg');
      const leftLeg = getFigureButton(kind, 'leftLeg');

      // 腕: 幅だけモデルで変わる（高さ 12）
      expect(rightArm.style.width).toBe(px(armWidth));
      expect(leftArm.style.width).toBe(px(armWidth));
      expect(rightArm.style.height).toBe(px(12));

      // 右腕（キャラクター視点）は画面の左端、左腕は胴体の右隣
      expect(rightArm.style.left).toBe(px(0));
      expect(body.style.left).toBe(px(armWidth));
      expect(leftArm.style.left).toBe(px(armWidth + 8));

      // 頭・胴体・足は腕の幅に関係なく同じ大きさ
      expect([head.style.width, head.style.height]).toEqual([px(8), px(8)]);
      expect([body.style.width, body.style.height]).toEqual([px(8), px(12)]);
      expect(rightLeg.style.width).toBe(px(4));
      expect(head.style.left).toBe(px(armWidth));
      expect(rightLeg.style.left).toBe(px(armWidth));
      expect(leftLeg.style.left).toBe(px(armWidth + 4));
      expect(rightLeg.style.top).toBe(px(20));

      // 図全体の幅も腕の幅に合わせて変わる
      expect(head.parentElement!.style.width).toBe(px(armWidth * 2 + 8));
      expect(head.parentElement!.style.height).toBe(px(32));
    }
  });

  it('モデルを切り替えると配置が追従する', () => {
    renderPicker();
    expect(getFigureButton('inner', 'leftArm').style.width).toBe('20px');

    act(() => {
      useEditorStore.getState().setModelType('alex');
    });
    expect(getFigureButton('inner', 'leftArm').style.width).toBe('15px');
    expect(getFigureButton('inner', 'leftArm').style.left).toBe('55px');
  });
});
