// @vitest-environment jsdom
// ポーズ設定（プリセット・角度スライダー）のテスト
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { PosePicker } from './PosePicker';
import { DEFAULT_POSE, POSE_PRESETS, type Pose } from '../../lib/pose';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

afterEach(cleanup);

function Harness({ onChange }: { onChange?: (pose: Pose) => void }) {
  const [pose, setPose] = useState<Pose>(DEFAULT_POSE);
  return (
    <PosePicker
      pose={pose}
      onChange={(next) => {
        setPose(next);
        onChange?.(next);
      }}
    />
  );
}

const presets = () => within(screen.getByRole('group', { name: 'ポーズのプリセット' }));

describe('PosePicker', () => {
  it('プリセットを選ぶとそのポーズになり、選んだプリセットが押された状態になる', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(presets().getByRole('button', { name: '標準' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(presets().getByRole('button', { name: '歩く' }));

    expect(onChange).toHaveBeenLastCalledWith(POSE_PRESETS.find((p) => p.id === 'walk')!.pose);
    expect(presets().getByRole('button', { name: '歩く' }).getAttribute('aria-pressed')).toBe('true');
    expect(presets().getByRole('button', { name: '標準' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('slider', { name: '右腕の前後（＋で前）' }).getAttribute('aria-valuenow')).toBe('30');
  });

  it('スライダーでパーツごとの角度を変えられ、「標準」で 0 に戻る', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: '左足の横（＋で外）' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_POSE, leftLeg: { forward: 0, side: 10 } });
    expect(presets().queryByRole('button', { pressed: true })).toBeNull();

    fireEvent.click(presets().getByRole('button', { name: '標準' }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_POSE);
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
  });
});
