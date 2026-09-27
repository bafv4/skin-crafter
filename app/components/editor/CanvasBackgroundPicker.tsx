import { useEditorStore } from '../../stores/editorStore';
import { Button } from '@components/ui/button';
import { Label } from '@components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip';
import { CHECKER_COLORS } from '@lib/skinRenderer';
import { cn } from '@lib/utils';
import type { CanvasBackground } from '../../types/editor';

// 背景のプリセット（単色は肌色や白と見分けやすい色を中心に）
const OPTIONS: { value: CanvasBackground; label: string }[] = [
  { value: { type: 'checker', variant: 'light' }, label: '市松（明）' },
  { value: { type: 'checker', variant: 'dark' }, label: '市松（暗）' },
  { value: { type: 'solid', color: '#000000' }, label: '黒' },
  { value: { type: 'solid', color: '#808080' }, label: 'グレー' },
  { value: { type: 'solid', color: '#ff00ff' }, label: 'マゼンタ' },
  { value: { type: 'solid', color: '#00ff00' }, label: 'グリーン' },
  { value: { type: 'solid', color: '#1e3a8a' }, label: '紺' },
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
function CanvasBackgroundSwatch({ background, className }: { background: CanvasBackground; className?: string }) {
  return (
    <span
      className={cn('inline-block rounded-sm border border-border', className)}
      style={background.type === 'checker' ? checkerStyle(background.variant) : { backgroundColor: background.color }}
    />
  );
}

// キャンバス上部の「背景」ボタン（ポップオーバーで背景を選択）
export function CanvasBackgroundMenu() {
  const background = useEditorStore((state) => state.canvasBackground);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-label="背景">
              <CanvasBackgroundSwatch background={background} className="mr-1 h-3 w-3" />
              背景
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>キャンバスの背景を変更</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <CanvasBackgroundPicker />
      </PopoverContent>
    </Popover>
  );
}

function CanvasBackgroundPicker() {
  const background = useEditorStore((state) => state.canvasBackground);
  const setBackground = useEditorStore((state) => state.setCanvasBackground);

  const customColor = background.type === 'solid' ? background.color : '#808080';
  const isCustom = !OPTIONS.some((option) => isSame(background, option.value));

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium">キャンバスの背景</Label>
        <p className="text-xs text-muted-foreground">
          透明部分の表示です。白など背景に近い色を塗った場所を見分けやすくできます。書き出す画像には影響しません。
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {OPTIONS.map((option) => {
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
