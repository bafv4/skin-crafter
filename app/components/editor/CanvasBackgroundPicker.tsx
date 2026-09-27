import { useEditorStore } from '../../stores/editorStore';
import { Label } from '@components/ui/label';
import { cn } from '@lib/utils';
import type { CanvasBackground } from '../../types/editor';

// 市松模様の配色
export const CHECKER_COLORS = {
  light: ['#ffffff', '#cccccc'],
  dark: ['#3a3a3a', '#2a2a2a'],
} as const;

// 単色背景のプリセット（肌色や白と見分けやすい色を中心に）
const SOLID_PRESETS: { color: string; label: string }[] = [
  { color: '#000000', label: '黒' },
  { color: '#808080', label: 'グレー' },
  { color: '#ff00ff', label: 'マゼンタ' },
  { color: '#00ff00', label: 'グリーン' },
  { color: '#1e3a8a', label: '紺' },
];

function checkerStyle(variant: 'light' | 'dark'): React.CSSProperties {
  const [c1, c2] = CHECKER_COLORS[variant];
  return {
    backgroundColor: c1,
    backgroundImage: `conic-gradient(${c2} 25%, ${c1} 0 50%, ${c2} 0 75%, ${c1} 0)`,
    backgroundSize: '12px 12px',
  };
}

function isSame(a: CanvasBackground, b: CanvasBackground): boolean {
  if (a.type === 'checker' && b.type === 'checker') return a.variant === b.variant;
  if (a.type === 'solid' && b.type === 'solid') return a.color.toLowerCase() === b.color.toLowerCase();
  return false;
}

// 背景の見本（ボタン内アイコン用にも使う）
export function CanvasBackgroundSwatch({ background, className }: { background: CanvasBackground; className?: string }) {
  return (
    <span
      className={cn('inline-block rounded-sm border border-border', className)}
      style={background.type === 'checker' ? checkerStyle(background.variant) : { backgroundColor: background.color }}
    />
  );
}

export function CanvasBackgroundPicker() {
  const background = useEditorStore((state) => state.canvasBackground);
  const setBackground = useEditorStore((state) => state.setCanvasBackground);

  const options: { value: CanvasBackground; label: string }[] = [
    { value: { type: 'checker', variant: 'light' }, label: '市松（明）' },
    { value: { type: 'checker', variant: 'dark' }, label: '市松（暗）' },
    ...SOLID_PRESETS.map((p) => ({ value: { type: 'solid', color: p.color } as CanvasBackground, label: p.label })),
  ];

  const customColor = background.type === 'solid' ? background.color : '#808080';
  const isCustom = background.type === 'solid' && !SOLID_PRESETS.some((p) => p.color === background.color.toLowerCase());

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium">キャンバスの背景</Label>
        <p className="text-xs text-muted-foreground">
          透明部分の表示です。白など背景に近い色を塗った場所を見分けやすくできます。書き出す画像には影響しません。
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => {
          const selected = isSame(background, option.value);
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={selected}
              onClick={() => setBackground(option.value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md p-1 text-[10px] transition-colors hover:bg-muted',
                selected && 'bg-muted ring-2 ring-primary'
              )}
            >
              <CanvasBackgroundSwatch background={option.value} className="h-8 w-full" />
              {option.label}
            </button>
          );
        })}
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center gap-1 rounded-md p-1 text-[10px] transition-colors hover:bg-muted',
            isCustom && 'bg-muted ring-2 ring-primary'
          )}
        >
          <span className="relative h-8 w-full overflow-hidden rounded-sm border border-border">
            <input
              type="color"
              aria-label="背景色を指定"
              value={customColor}
              onChange={(e) => setBackground({ type: 'solid', color: e.target.value })}
              className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 p-0"
            />
          </span>
          カスタム
        </label>
      </div>
    </div>
  );
}
