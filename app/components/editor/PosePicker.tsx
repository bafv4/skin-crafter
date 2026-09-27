// 3D プレビューのポーズ設定（プリセットと、頭・腕・足ごとの角度）
import { Button } from '@components/ui/button';
import { Slider } from '@components/ui/slider';
import {
  POSE_PART_KEYS,
  POSE_PRESETS,
  POSE_RANGES,
  DEFAULT_POSE,
  isSamePose,
  type JointAngles,
  type Pose,
  type PosePartKey,
} from '../../lib/pose';

const PART_LABELS: Record<PosePartKey, string> = {
  head: '頭',
  rightArm: '右腕',
  leftArm: '左腕',
  rightLeg: '右足',
  leftLeg: '左足',
};

// 各パーツのスライダーの名前（プラス方向の意味）
const AXIS_LABELS: Record<PosePartKey, Record<keyof JointAngles, string>> = {
  head: { forward: '上下（＋で上）', side: '左右（＋で左）' },
  rightArm: { forward: '前後（＋で前）', side: '横（＋で外）' },
  leftArm: { forward: '前後（＋で前）', side: '横（＋で外）' },
  rightLeg: { forward: '前後（＋で前）', side: '横（＋で外）' },
  leftLeg: { forward: '前後（＋で前）', side: '横（＋で外）' },
};

const AXES: (keyof JointAngles)[] = ['forward', 'side'];

export function PosePicker({ pose, onChange }: { pose: Pose; onChange: (pose: Pose) => void }) {
  const setAngle = (part: PosePartKey, axis: keyof JointAngles, value: number) => {
    onChange({ ...pose, [part]: { ...pose[part], [axis]: value } });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">ポーズ</p>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(DEFAULT_POSE)}>
          標準に戻す
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="ポーズのプリセット">
        {POSE_PRESETS.map((preset) => {
          const active = isSamePose(pose, preset.pose);
          return (
            <Button
              key={preset.id}
              variant={active ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              aria-pressed={active}
              onClick={() => onChange(preset.pose)}
            >
              {preset.label}
            </Button>
          );
        })}
      </div>

      <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto border-t pt-3 pr-1">
        {POSE_PART_KEYS.map((part) => (
          <div key={part} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">{PART_LABELS[part]}</p>
            {AXES.map((axis) => {
              const [min, max] = POSE_RANGES[part][axis];
              const label = `${PART_LABELS[part]}の${AXIS_LABELS[part][axis]}`;
              return (
                <div key={axis} className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{AXIS_LABELS[part][axis]}</span>
                  <Slider
                    value={[pose[part][axis]]}
                    onValueChange={([v]) => setAngle(part, axis, v)}
                    min={min}
                    max={max}
                    step={5}
                    thumbLabel={label}
                  />
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">{pose[part][axis]}°</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
