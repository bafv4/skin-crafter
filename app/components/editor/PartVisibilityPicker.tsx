import { useEditorStore } from '../../stores/editorStore';
import { Button } from '@components/ui/button';
import { cn } from '@lib/utils';
import {
  BODY_PART_KEYS,
  createPartVisibility,
  type BodyPartKey,
  type PartVisibility,
} from './Preview3D.client';

type LayerKind = 'inner' | 'outer';

const PART_LABELS: Record<BodyPartKey, string> = {
  head: '頭',
  body: '胴体',
  rightArm: '右腕',
  leftArm: '左腕',
  rightLeg: '右足',
  leftLeg: '左足',
};

// 1スキンピクセルあたりの表示サイズ（px）
const UNIT = 5;

// 正面から見たキャラクターの各パーツ配置（スキンピクセル単位）
// 右腕・右足はキャラクター視点の右なので、画面上では左側に来る
function getPartRects(armWidth: number): Record<BodyPartKey, { x: number; y: number; w: number; h: number }> {
  return {
    head: { x: armWidth, y: 0, w: 8, h: 8 },
    rightArm: { x: 0, y: 8, w: armWidth, h: 12 },
    body: { x: armWidth, y: 8, w: 8, h: 12 },
    leftArm: { x: armWidth + 8, y: 8, w: armWidth, h: 12 },
    rightLeg: { x: armWidth, y: 20, w: 4, h: 12 },
    leftLeg: { x: armWidth + 4, y: 20, w: 4, h: 12 },
  };
}

function PartFigure({
  kind,
  visibility,
  armWidth,
  disabled,
  onToggle,
}: {
  kind: LayerKind;
  visibility: PartVisibility;
  armWidth: number;
  disabled: boolean;
  onToggle: (part: BodyPartKey) => void;
}) {
  const rects = getPartRects(armWidth);
  const layerLabel = kind === 'inner' ? '内側' : '外側';

  return (
    <div
      className={cn('relative', disabled && 'opacity-40')}
      style={{ width: (armWidth * 2 + 8) * UNIT, height: 32 * UNIT }}
    >
      {BODY_PART_KEYS.map((part) => {
        const rect = rects[part];
        const visible = visibility[part][kind];
        return (
          <button
            key={part}
            type="button"
            disabled={disabled}
            aria-pressed={visible}
            aria-label={`${layerLabel}の${PART_LABELS[part]}を${visible ? '非表示' : '表示'}`}
            title={`${PART_LABELS[part]}（${layerLabel}）`}
            onClick={() => onToggle(part)}
            className={cn(
              'absolute border transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring',
              visible
                ? 'border-primary/60 bg-primary/70 hover:bg-primary/85'
                : 'border-dashed border-muted-foreground/50 bg-transparent hover:bg-muted',
              disabled && 'cursor-not-allowed'
            )}
            style={{
              left: rect.x * UNIT,
              top: rect.y * UNIT,
              width: rect.w * UNIT,
              height: rect.h * UNIT,
            }}
          />
        );
      })}
    </div>
  );
}

// NovaSkin 風のパーツ別表示切り替え
export function PartVisibilityPicker({
  visibility,
  onChange,
}: {
  visibility: PartVisibility;
  onChange: (visibility: PartVisibility) => void;
}) {
  const modelType = useEditorStore((state) => state.modelType);
  const showLayer2 = useEditorStore((state) => state.showLayer2);
  const armWidth = modelType === 'alex' ? 3 : 4;

  const togglePart = (kind: LayerKind) => (part: BodyPartKey) => {
    onChange({
      ...visibility,
      [part]: { ...visibility[part], [kind]: !visibility[part][kind] },
    });
  };

  // 指定パーツだけを表示（内側・外側とも）
  const showOnly = (part: BodyPartKey) => {
    const next = createPartVisibility(false);
    next[part] = { inner: true, outer: true };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-around gap-4">
        {(['inner', 'outer'] as const).map((kind) => (
          <div key={kind} className="flex flex-col items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {kind === 'inner' ? '内側（レイヤー1）' : '外側（レイヤー2）'}
            </span>
            <PartFigure
              kind={kind}
              visibility={visibility}
              armWidth={armWidth}
              disabled={kind === 'outer' && !showLayer2}
              onToggle={togglePart(kind)}
            />
          </div>
        ))}
      </div>
      {!showLayer2 && (
        <p className="text-center text-xs text-muted-foreground">
          外側はレイヤー2の表示がオフのため無効です
        </p>
      )}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">このパーツだけ表示</span>
        <div className="grid grid-cols-3 gap-1">
          {BODY_PART_KEYS.map((part) => (
            <Button key={part} variant="outline" size="sm" className="h-7 text-xs" onClick={() => showOnly(part)}>
              {PART_LABELS[part]}
            </Button>
          ))}
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={() => onChange(createPartVisibility(true))}
      >
        すべて表示
      </Button>
    </div>
  );
}
