import { useState, memo, useCallback, useMemo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { Pipette, Plus, Trash2, Wand2, Merge, GitMerge, RefreshCw, GripVertical, ChevronRight, ChevronDown, FolderPlus, Palette, PaintBucket, Settings2, Eye, EyeOff, Copy, MoreHorizontal } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import { Slider } from '@components/ui/slider';
import { ColorPicker } from '@components/ui/color-picker';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { Checkbox } from '@components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';
import { useEditorStore } from '../../stores/editorStore';
import { sortFrontToBack } from '../../lib/layerComposite';
import { rgbaToHex, type RGBA, type Layer, type LayerGroup, type MaterialType } from '../../types/editor';

// Drag and drop context
interface DragState {
  type: 'layer' | 'group';
  id: string;
}

let draggedItem: DragState | null = null;

// Material options for noise generation
const MATERIAL_OPTIONS: { value: MaterialType; label: string; description: string }[] = [
  { value: 'other', label: 'その他', description: '標準的なノイズパターン' },
  { value: 'hair', label: '髪', description: '髪の毛のような暗いストリークと暖色系' },
  { value: 'cloth', label: '布', description: '布地のような微細なフェード効果' },
  { value: 'skin', label: '肌', description: '暖色系の柔らかいバリエーション' },
  { value: 'metal', label: '金属', description: 'ハイライトを含む高コントラスト' },
  { value: 'plastic', label: 'プラスチック', description: '滑らかで均一な光沢のある表面' },
];

// Threshold preset markers for slider
const THRESHOLD_PRESETS = [
  { value: 15, label: '厳密' },
  { value: 30, label: '標準' },
  { value: 50, label: '緩め' },
  { value: 80, label: 'とても緩め' },
];

// Auto-generate options dialog (exported for use in Toolbar)
export function GenerateOptionsDialog({
  open,
  onOpenChange,
  onGenerate,
  title = 'Auto-generate Layers',
  description = 'Generate layers from pixel colors with similar colors grouped together.',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (options: { thresholdValue: number; applyNoise: boolean }) => void;
  title?: string;
  description?: string;
}) {
  const [thresholdValue, setThresholdValue] = useState(30); // Default: normal
  const [applyNoise, setApplyNoise] = useState(true);

  const handleGenerate = () => {
    onGenerate({ thresholdValue, applyNoise });
    onOpenChange(false);
  };

  // Get label for current threshold value
  const getThresholdLabel = (value: number) => {
    if (value <= 15) return '厳密';
    if (value <= 30) return '標準';
    if (value <= 50) return '緩め';
    return 'とても緩め';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>色の類似度しきい値</Label>
              <span className="text-sm text-muted-foreground">
                {thresholdValue} ({getThresholdLabel(thresholdValue)})
              </span>
            </div>
            <Slider
              value={[thresholdValue]}
              onValueChange={([v]) => setThresholdValue(v)}
              min={5}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>レイヤー数多い</span>
              <span>レイヤー数少ない</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground/60">
              {THRESHOLD_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className="hover:text-foreground transition-colors"
                  onClick={() => setThresholdValue(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="apply-noise"
              checked={applyNoise}
              onCheckedChange={(checked) => setApplyNoise(checked === true)}
            />
            <Label htmlFor="apply-noise" className="cursor-pointer">
              しきい値に基づいてノイズを適用
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            有効にすると、統合された色のバリエーションをノイズで補完し、視覚的なディテールを維持します。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleGenerate}>生成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Merge target selection dialog - optimized with individual selectors
function MergeDialog({
  open,
  onOpenChange,
  sourceLayerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceLayerId: string;
}) {
  // Only subscribe when dialog is open to avoid unnecessary re-renders
  const layers = useEditorStore((state) => open ? state.layers : []);
  const mergeLayersById = useEditorStore((state) => state.mergeLayersById);
  const [targetLayerId, setTargetLayerId] = useState<string>('');

  const sourceLayer = layers.find((l) => l.id === sourceLayerId);
  const otherLayers = layers.filter((l) => l.id !== sourceLayerId);

  const handleMerge = () => {
    if (targetLayerId) {
      mergeLayersById(sourceLayerId, targetLayerId);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>レイヤーを統合</DialogTitle>
          <DialogDescription>
            「{sourceLayer?.name}」を別のレイヤーに統合します。すべてのピクセルが移動します。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>統合先レイヤー</Label>
            <Select value={targetLayerId} onValueChange={setTargetLayerId}>
              <SelectTrigger>
                <SelectValue placeholder="レイヤーを選択..." />
              </SelectTrigger>
              <SelectContent>
                {otherLayers.map((layer) => (
                  <SelectItem key={layer.id} value={layer.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: rgbaToHex(layer.baseColor) }}
                      />
                      <span>{layer.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleMerge} disabled={!targetLayerId}>
            統合
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Noise settings dialog
function NoiseDialog({
  open,
  onOpenChange,
  layerId,
  layerName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layerId: string;
  layerName: string;
}) {
  const { layers, applyNoise } = useEditorStore();
  const layer = layers.find((l) => l.id === layerId);

  // Sliders now range from -100 to +100 (0 = no effect)
  const [brightness, setBrightness] = useState(layer?.noiseSettings.brightness ?? 0);
  const [hue, setHue] = useState(layer?.noiseSettings.hue ?? 0);
  const [material, setMaterial] = useState<MaterialType>('other');

  const handleApply = () => {
    // Convert signed value to absolute + direction for the store
    const brightnessDir = brightness >= 0 ? 'positive' : 'negative';
    const hueDir = hue >= 0 ? 'positive' : 'negative';
    applyNoise(layerId, Math.abs(brightness), Math.abs(hue), brightnessDir, hueDir, material);
    onOpenChange(false);
  };

  const handleRegenerate = () => {
    // Re-apply noise with same settings to generate new random pattern
    const brightnessDir = brightness >= 0 ? 'positive' : 'negative';
    const hueDir = hue >= 0 ? 'positive' : 'negative';
    applyNoise(layerId, Math.abs(brightness), Math.abs(hue), brightnessDir, hueDir, material);
  };

  const selectedMaterial = MATERIAL_OPTIONS.find((m) => m.value === material);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>ノイズを適用 - {layerName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6 py-4">
          <div className="flex flex-col gap-2">
            <Label>マテリアル</Label>
            <Select value={material} onValueChange={(v) => setMaterial(v as MaterialType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedMaterial && (
              <p className="text-xs text-muted-foreground">{selectedMaterial.description}</p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>明るさ</Label>
              <span className="text-sm text-muted-foreground">{formatPercent(brightness)}</span>
            </div>
            <Slider
              value={[brightness]}
              onValueChange={([v]) => setBrightness(v)}
              min={-100}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>暗い</span>
              <span>明るい</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>色相シフト</Label>
              <span className="text-sm text-muted-foreground">{formatPercent(hue)}</span>
            </div>
            <Slider
              value={[hue]}
              onValueChange={([v]) => setHue(v)}
              min={-100}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>寒色</span>
              <span>暖色</span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleRegenerate}
            disabled={brightness === 0 && hue === 0}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            再生成
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleApply}>適用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Layer group detail dialog - for editing group name
function LayerGroupDetailDialog({
  open,
  onOpenChange,
  groupId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
}) {
  const group = useEditorStore(
    useShallow((state) => {
      if (!open) return null;
      return state.layerGroups.find((g) => g.id === groupId) ?? null;
    })
  );
  const updateLayerGroupName = useEditorStore((state) => state.updateLayerGroupName);

  const [editName, setEditName] = useState(group?.name ?? '');

  // Reset state when dialog opens with new group
  useEffect(() => {
    if (open && group) {
      setEditName(group.name);
    }
  }, [open, group]);

  if (!group) return null;

  const handleSave = () => {
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== group.name) {
      updateLayerGroupName(groupId, trimmedName);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>グループ設定</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>グループ名</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Logarithmic scale conversion for sliders
// Converts linear slider value (0-100) to logarithmic actual value (0-20)
function linearToLog(linearValue: number): number {
  if (linearValue === 0) return 0;
  const sign = linearValue >= 0 ? 1 : -1;
  const absValue = Math.abs(linearValue);
  // Use log scale: maps 0->0, 50->~2, 100->20
  const logValue = (Math.pow(10, absValue / 50) - 1) * (20 / 99);
  return sign * logValue;
}

// Converts logarithmic actual value back to linear slider value
function logToLinear(logValue: number): number {
  if (logValue === 0) return 0;
  const sign = logValue >= 0 ? 1 : -1;
  const absValue = Math.abs(logValue);
  // Inverse: maps 0->0, 20->100
  const linearValue = 50 * Math.log10(absValue * 99 / 20 + 1);
  return Math.round(sign * Math.min(100, linearValue));
}

// Format value with 2 significant figures
function formatPercent(val: number): string {
  if (val === 0) return '0%';
  const sign = val >= 0 ? '+' : '';
  const absVal = Math.abs(val);
  // Use toPrecision for 2 significant figures, then convert back to number to remove trailing zeros
  const formatted = Number(absVal.toPrecision(2));
  return `${sign}${val >= 0 ? formatted : -formatted}%`;
}

// Layer detail dialog - unified settings for layer type and noise - optimized
function LayerDetailDialog({
  open,
  onOpenChange,
  layerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layerId: string;
}) {
  // Only subscribe to specific layer data when dialog is open
  const layer = useEditorStore(
    useShallow((state) => {
      if (!open) return null;
      return state.layers.find((l) => l.id === layerId) ?? null;
    })
  );
  const applyNoise = useEditorStore((state) => state.applyNoise);
  const resetNoise = useEditorStore((state) => state.resetNoise);
  const updateLayerType = useEditorStore((state) => state.updateLayerType);
  const updateLayerColor = useEditorStore((state) => state.updateLayerColor);
  const saveToHistory = useEditorStore((state) => state.saveToHistory);
  const updateLayerName = useEditorStore((state) => state.updateLayerName);
  const updateLayerOpacity = useEditorStore((state) => state.updateLayerOpacity);
  const startLayerColorPick = useEditorStore((state) => state.startLayerColorPick);
  // キャンバスから基本色を取得している間はダイアログを一時的に隠す
  // （コンポーネントはマウントしたままにし、未適用のノイズ設定などを保持する）
  const isPickingColor = useEditorStore((state) => state.layerColorPickTarget === layerId);

  // Layer name editing
  const [editName, setEditName] = useState(layer?.name ?? '');

  // Noise settings - store as linear slider values internally
  const [brightnessSlider, setBrightnessSlider] = useState(0);
  const [hueSlider, setHueSlider] = useState(0);
  const [material, setMaterial] = useState<MaterialType>('other');

  // Reset states when dialog opens with new layer
  useEffect(() => {
    if (open && layer) {
      setEditName(layer.name);
      // Convert stored log values back to linear slider positions
      setBrightnessSlider(logToLinear(layer.noiseSettings.brightness ?? 0));
      setHueSlider(logToLinear(layer.noiseSettings.hue ?? 0));
      setMaterial(layer.noiseSettings.material ?? 'other');
    }
  }, [open, layer?.id]);

  if (!layer) return null;

  // Get actual logarithmic values for display and application
  const brightness = linearToLog(brightnessSlider);
  const hue = linearToLog(hueSlider);

  const handleApplyNoise = () => {
    const brightnessDir = brightness >= 0 ? 'positive' : 'negative';
    const hueDir = hue >= 0 ? 'positive' : 'negative';
    applyNoise(layerId, Math.abs(brightness), Math.abs(hue), brightnessDir, hueDir, material);
  };

  const handleResetNoise = () => {
    resetNoise(layerId);
    setBrightnessSlider(0);
    setHueSlider(0);
  };

  const handleNameChange = () => {
    if (editName.trim() && editName !== layer.name) {
      updateLayerName(layerId, editName.trim());
    }
  };

  const selectedMaterial = MATERIAL_OPTIONS.find((m) => m.value === material);

  const isDirectMode = layer.layerType === 'direct';

  // Check if noise has been applied (to show reset button)
  const hasNoise = layer.noiseSettings.brightness !== 0 || layer.noiseSettings.hue !== 0;

  const handleSave = () => {
    handleNameChange();
    onOpenChange(false);
  };

  return (
    <Dialog open={open && !isPickingColor} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>レイヤー設定</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4 flex-1 overflow-y-auto">
          {/* Layer Name */}
          <div className="flex flex-col gap-2">
            <Label>レイヤー名</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameChange}
              onKeyDown={(e) => e.key === 'Enter' && handleNameChange()}
            />
          </div>

          {/* Layer Type */}
          <div className="flex flex-col gap-2">
            <Label>レイヤータイプ</Label>
            <div className="flex gap-2">
              <Button
                variant={layer.layerType === 'singleColor' ? 'default' : 'outline'}
                className="flex-1 gap-2"
                onClick={() => updateLayerType(layerId, 'singleColor')}
              >
                <PaintBucket className="h-4 w-4" />
                単色モード
              </Button>
              <Button
                variant={layer.layerType === 'direct' ? 'default' : 'outline'}
                className="flex-1 gap-2"
                onClick={() => updateLayerType(layerId, 'direct')}
              >
                <Palette className="h-4 w-4" />
                マルチカラー
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {layer.layerType === 'singleColor'
                ? '描画時にレイヤーの基本色が使用されます'
                : '描画時にツールバーの描画カラーが使用されます'}
            </p>
          </div>

          {/* Base Color (only for singleColor mode) */}
          {layer.layerType === 'singleColor' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>基本色</Label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  onClick={() => {
                    handleNameChange();
                    startLayerColorPick(layerId);
                  }}
                >
                  <Pipette className="h-3.5 w-3.5" />
                  キャンバスから取得
                </Button>
              </div>
              <div className="p-3 border rounded-lg">
                <ColorPicker
                  color={layer.baseColor}
                  onChange={(color) => updateLayerColor(layerId, color)}
                  onChangeComplete={saveToHistory}
                />
              </div>
            </div>
          )}

          {/* Opacity */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>不透明度</Label>
              <span className="text-sm text-muted-foreground">{layer.opacity ?? 100}%</span>
            </div>
            <Slider
              value={[layer.opacity ?? 100]}
              onValueChange={([v]) => updateLayerOpacity(layerId, v)}
              min={0}
              max={100}
              step={1}
            />
          </div>

          {/* Noise Section */}
          <div className={`flex flex-col gap-3 border-t pt-4 ${isDirectMode ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                ノイズ
              </Label>
              <div className="flex gap-2">
                {hasNoise && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResetNoise}
                    disabled={isDirectMode}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    リセット
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleApplyNoise}
                  disabled={isDirectMode || (brightness === 0 && hue === 0)}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  生成
                </Button>
              </div>
            </div>

            {isDirectMode && (
              <p className="text-xs text-muted-foreground">
                マルチカラーモードではノイズを適用できません
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Label className="text-sm">マテリアル</Label>
              <Select value={material} onValueChange={(v) => setMaterial(v as MaterialType)} disabled={isDirectMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedMaterial && !isDirectMode && (
                <p className="text-xs text-muted-foreground">{selectedMaterial.description}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">明るさ</Label>
                <span className="text-sm text-muted-foreground">{formatPercent(brightness)}</span>
              </div>
              <Slider
                value={[brightnessSlider]}
                onValueChange={([v]) => setBrightnessSlider(v)}
                min={-100}
                max={100}
                step={1}
                disabled={isDirectMode}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">色相シフト</Label>
                <span className="text-sm text-muted-foreground">{formatPercent(hue)}</span>
              </div>
              <Slider
                value={[hueSlider]}
                onValueChange={([v]) => setHueSlider(v)}
                min={-100}
                max={100}
                step={1}
                disabled={isDirectMode}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4 mt-auto shrink-0">
          <Button onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 名前のインライン編集（ダブルクリックで開始）
// Enter / フォーカスアウトで確定、Esc でキャンセル。空の名前は無視する
function InlineNameInput({
  initialName,
  onCommit,
  onClose,
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const doneRef = useRef(false);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = value.trim();
    if (commit && trimmed && trimmed !== initialName) {
      onCommit(trimmed);
    }
    onClose();
  };

  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label="名前"
      className="h-6 flex-1 min-w-0 px-1.5 py-0 text-sm font-medium"
    />
  );
}

// Layer item component - optimized with memo and shallow selectors
const LayerItem = memo(function LayerItem({
  layerId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onOpenDetailDialog,
  onOpenMergeDialog,
  onOpenDeleteDialog,
}: {
  layerId: string;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, targetId: string, position: 'before' | 'after') => void;
  onOpenDetailDialog?: (layerId: string) => void;
  onOpenMergeDialog?: (layerId: string) => void;
  onOpenDeleteDialog?: (layerId: string, layerName: string) => void;
}) {
  // Use shallow selector to get layer data - only re-renders when this specific layer changes
  const layer = useEditorStore(
    useShallow((state) => {
      const l = state.layers.find((layer) => layer.id === layerId);
      if (!l) return null;
      // Return a new object only with the properties we need
      return {
        id: l.id,
        name: l.name,
        baseColor: l.baseColor,
        layerType: l.layerType,
        visible: l.visible,
      };
    })
  );
  const isActive = useEditorStore((state) => state.activeLayerId === layerId);
  const layerCount = useEditorStore((state) => state.layers.length);
  const setActiveLayer = useEditorStore((state) => state.setActiveLayer);
  const setHighlightedLayer = useEditorStore((state) => state.setHighlightedLayer);
  const updateLayerColor = useEditorStore((state) => state.updateLayerColor);
  const saveToHistory = useEditorStore((state) => state.saveToHistory);
  const toggleLayerVisibility = useEditorStore((state) => state.toggleLayerVisibility);
  const duplicateLayer = useEditorStore((state) => state.duplicateLayer);
  const updateLayerName = useEditorStore((state) => state.updateLayerName);

  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const canMerge = layerCount > 1;

  if (!layer) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent group from receiving this event
    if (!draggedItem || draggedItem.id === layerId || draggedItem.type !== 'layer') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropPosition(e.clientY < midY ? 'before' : 'after');
    onDragOver?.(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent group from receiving this event
    if (dropPosition && draggedItem?.type === 'layer') {
      onDrop?.(e, layerId, dropPosition);
    }
    setDropPosition(null);
    // 移動でドラッグ元の要素が作り直されると dragend が届かないので、ドロップ時にも解除する
    draggedItem = null;
  };

  const handleDragLeave = () => {
    setDropPosition(null);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative">
        {/* Drop indicator - before */}
        {dropPosition === 'before' && (
          <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10" />
        )}
        <div
          className={`flex flex-col rounded-lg border p-2 transition-all hover:border-muted-foreground/50 ${
            isActive
              ? 'border-primary bg-primary/5'
              : 'border-border bg-card'
          } ${dropPosition ? 'ring-2 ring-blue-500/30' : ''}`}
          onClick={() => setActiveLayer(layerId)}
          onMouseEnter={() => setHighlightedLayer(layerId)}
          onMouseLeave={() => setHighlightedLayer(null)}
          draggable={!isRenaming}
          onDragStart={(e) => onDragStart?.(e, layerId)}
          onDragEnd={onDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
        >
        {/* Row 1: Drag handle, Visibility toggle, Color indicator, and name */}
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" />

          {/* Visibility toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-6 w-6 shrink-0 ${!layer.visible ? 'text-muted-foreground' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayerVisibility(layerId);
                }}
              >
                {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{layer.visible ? 'レイヤーを非表示' : 'レイヤーを表示'}</p>
            </TooltipContent>
          </Tooltip>

          {/* Color indicator - only show for singleColor mode */}
          {layer.layerType === 'singleColor' && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="h-6 w-6 shrink-0 rounded border border-border"
                  style={{ backgroundColor: rgbaToHex(layer.baseColor) }}
                  onClick={(e) => e.stopPropagation()}
                />
              </PopoverTrigger>
              <PopoverContent className="w-48" onClick={(e) => e.stopPropagation()}>
                <ColorPicker
                  color={layer.baseColor}
                  onChange={(color) => updateLayerColor(layerId, color)}
                  onChangeComplete={saveToHistory}
                />
              </PopoverContent>
            </Popover>
          )}

          {/* Layer type indicator */}
          {layer.layerType === 'direct' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="h-6 w-6 shrink-0 rounded border border-border bg-gradient-to-br from-red-400 via-green-400 to-blue-400 flex items-center justify-center">
                  <Palette className="h-3 w-3 text-white drop-shadow-sm" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>マルチカラーモード</p>
              </TooltipContent>
            </Tooltip>
          )}

          {isRenaming ? (
            <InlineNameInput
              initialName={layer.name}
              onCommit={(name) => updateLayerName(layerId, name)}
              onClose={() => setIsRenaming(false)}
            />
          ) : (
            <span
              className="flex-1 text-sm font-medium truncate cursor-text"
              title="ダブルクリックで名前を変更"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
              }}
            >
              {layer.name}
            </span>
          )}
        </div>

        {/* Row 2: Action buttons */}
        <div className="flex items-center gap-1 mt-1 ml-6">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetailDialog?.(layerId);
            }}
          >
            <Settings2 className="h-3.5 w-3.5 mr-1" />
            レイヤー設定
          </Button>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => duplicateLayer(layerId)}>
                <Copy className="h-4 w-4 mr-2" />
                複製
              </DropdownMenuItem>
              {canMerge && (
                <DropdownMenuItem onClick={() => onOpenMergeDialog?.(layerId)}>
                  <GitMerge className="h-4 w-4 mr-2" />
                  統合
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onOpenDeleteDialog?.(layerId, layer.name)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                削除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>
        {/* Drop indicator - after */}
        {dropPosition === 'after' && (
          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10" />
        )}
      </div>
    </TooltipProvider>
  );
});

// Layer Group Item component - optimized with memo
const LayerGroupItem = memo(function LayerGroupItem({
  group,
  children,
  onDragStart,
  onDragEnd,
  onDragOver,
  onLayerDrop,
  onLayerDropOutside,
  onGroupDrop,
  onOpenDetailDialog,
}: {
  group: LayerGroup;
  children: React.ReactNode;
  onDragStart?: (e: React.DragEvent, id: string, type: 'group') => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onLayerDrop?: (e: React.DragEvent, groupId: string) => void;
  onLayerDropOutside?: (e: React.DragEvent, position: 'before' | 'after', referenceGroupId: string) => void;
  onGroupDrop?: (e: React.DragEvent, targetGroupId: string, position: 'before' | 'after') => void;
  onOpenDetailDialog?: (groupId: string) => void;
}) {
  const toggleLayerGroupCollapsed = useEditorStore((state) => state.toggleLayerGroupCollapsed);
  const deleteLayerGroup = useEditorStore((state) => state.deleteLayerGroup);
  const recordHistory = useEditorStore((state) => state.recordHistory);
  const toggleLayerGroupVisibility = useEditorStore((state) => state.toggleLayerGroupVisibility);
  const updateLayerGroupName = useEditorStore((state) => state.updateLayerGroupName);

  const [isRenaming, setIsRenaming] = useState(false);

  const [dropTarget, setDropTarget] = useState(false);
  const [groupDropPosition, setGroupDropPosition] = useState<'before' | 'after' | null>(null);
  const [layerDropPosition, setLayerDropPosition] = useState<'before' | 'after' | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedItem) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const edgeThreshold = 12; // pixels from edge to trigger before/after placement

    if (draggedItem.type === 'layer') {
      // If near top/bottom edge, show position indicator for placing outside group
      if (relativeY < edgeThreshold) {
        setLayerDropPosition('before');
        setDropTarget(false);
      } else if (relativeY > rect.height - edgeThreshold) {
        setLayerDropPosition('after');
        setDropTarget(false);
      } else {
        // Otherwise, show as drop into group
        setDropTarget(true);
        setLayerDropPosition(null);
      }
      setGroupDropPosition(null);
    } else if (draggedItem.type === 'group' && draggedItem.id !== group.id) {
      const midY = rect.top + rect.height / 2;
      setGroupDropPosition(e.clientY < midY ? 'before' : 'after');
      setDropTarget(false);
      setLayerDropPosition(null);
    }
    onDragOver?.(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // パネル側の「グループの外へ出す」処理に伝わると、グループに入れたレイヤーがすぐ外へ出てしまう
    e.stopPropagation();
    if (!draggedItem) return;

    if (draggedItem.type === 'layer') {
      if (layerDropPosition) {
        // Drop outside group (before/after)
        onLayerDropOutside?.(e, layerDropPosition, group.id);
      } else {
        // Drop inside group
        onLayerDrop?.(e, group.id);
      }
    } else if (draggedItem.type === 'group' && groupDropPosition) {
      onGroupDrop?.(e, group.id, groupDropPosition);
    }
    setDropTarget(false);
    setGroupDropPosition(null);
    setLayerDropPosition(null);
    draggedItem = null;
  };

  const handleDragLeave = () => {
    setDropTarget(false);
    setGroupDropPosition(null);
    setLayerDropPosition(null);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative">
        {/* Drop indicator - before (for both group and layer) */}
        {(groupDropPosition === 'before' || layerDropPosition === 'before') && (
          <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10" />
        )}
        <div
          className={`rounded-lg border transition-all ${
            dropTarget ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border'
          } ${groupDropPosition || layerDropPosition ? 'ring-2 ring-blue-500/30' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
        >
        <div
          className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/50"
          draggable={!isRenaming}
          onDragStart={(e) => onDragStart?.(e, group.id, 'group')}
          onDragEnd={onDragEnd}
        >
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            onClick={() => toggleLayerGroupCollapsed(group.id)}
            className="shrink-0 rounded p-0.5 -m-0.5 hover:bg-muted"
            aria-label={group.collapsed ? 'グループを展開' : 'グループを折りたたむ'}
          >
            {group.collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {isRenaming ? (
            <InlineNameInput
              initialName={group.name}
              onCommit={(name) => updateLayerGroupName(group.id, name)}
              onClose={() => setIsRenaming(false)}
            />
          ) : (
            // 開閉は左の矢印ボタンのみ。名前はダブルクリックで変更する
            <span
              className="flex-1 min-w-0 text-left text-sm font-medium truncate cursor-default"
              title="ダブルクリックで名前を変更"
              onDoubleClick={() => setIsRenaming(true)}
            >
              {group.name}
            </span>
          )}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetailDialog?.(group.id);
              }}
            >
              <Settings2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>グループ設定</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 shrink-0 ${!group.visible ? 'text-muted-foreground' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleLayerGroupVisibility(group.id);
              }}
            >
              {group.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{group.visible ? 'グループを非表示' : 'グループを表示'}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(true);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>グループを削除</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {!group.collapsed && (
        <div className="flex flex-col gap-1 px-2 pb-2 pl-6">
          {children}
        </div>
      )}

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>グループを削除</AlertDialogTitle>
              <AlertDialogDescription>
                「{group.name}」を削除しますか？グループ内のレイヤーはグループから外れますが、削除されません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => recordHistory(() => deleteLayerGroup(group.id))}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                削除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
        {/* Drop indicator - after (for both group and layer) */}
        {(groupDropPosition === 'after' || layerDropPosition === 'after') && (
          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10" />
        )}
      </div>
    </TooltipProvider>
  );
});

export function LayerPanel({ width }: { width?: number }) {
  // Use individual selectors to minimize re-renders
  // Custom equality: only re-render when layer metadata changes (not pixel data)
  const layers = useStoreWithEqualityFn(
    useEditorStore,
    (state) => state.layers,
    (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const la = a[i], lb = b[i];
        if (la.id !== lb.id || la.name !== lb.name || la.order !== lb.order ||
            la.visible !== lb.visible || la.opacity !== lb.opacity ||
            la.groupId !== lb.groupId || la.layerType !== lb.layerType ||
            la.baseColor.r !== lb.baseColor.r || la.baseColor.g !== lb.baseColor.g ||
            la.baseColor.b !== lb.baseColor.b || la.baseColor.a !== lb.baseColor.a ||
            la.noiseSettings.brightness !== lb.noiseSettings.brightness ||
            la.noiseSettings.hue !== lb.noiseSettings.hue ||
            la.noiseSettings.material !== lb.noiseSettings.material) {
          return false;
        }
      }
      return true;
    }
  );
  const layerGroups = useStoreWithEqualityFn(
    useEditorStore,
    (state) => state.layerGroups,
    (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const ga = a[i], gb = b[i];
        if (ga.id !== gb.id || ga.name !== gb.name || ga.collapsed !== gb.collapsed ||
            ga.order !== gb.order || ga.visible !== gb.visible) {
          return false;
        }
      }
      return true;
    }
  );
  const activeLayerId = useEditorStore((state) => state.activeLayerId);
  const createLayer = useEditorStore((state) => state.createLayer);
  const createLayerGroup = useEditorStore((state) => state.createLayerGroup);
  const mergeSimilarLayersAction = useEditorStore((state) => state.mergeSimilarLayersAction);
  const reorderLayer = useEditorStore((state) => state.reorderLayer);
  const reorderLayerGroup = useEditorStore((state) => state.reorderLayerGroup);
  const moveLayerToGroup = useEditorStore((state) => state.moveLayerToGroup);
  const recordHistory = useEditorStore((state) => state.recordHistory);
  const deleteLayer = useEditorStore((state) => state.deleteLayer);

  // Shared dialog state - single dialogs instead of per-layer dialogs
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [detailDialogLayerId, setDetailDialogLayerId] = useState<string | null>(null);
  const [detailDialogGroupId, setDetailDialogGroupId] = useState<string | null>(null);
  const [mergeSourceLayerId, setMergeSourceLayerId] = useState<string | null>(null);
  const [deleteDialogState, setDeleteDialogState] = useState<{ layerId: string; layerName: string } | null>(null);

  // 手前から奥の順（キャンバスの重なり順と同じ並び）
  const sortedLayers = useMemo(() => sortFrontToBack(layers), [layers]);
  const sortedGroups = useMemo(() => sortFrontToBack(layerGroups), [layerGroups]);

  // Memoize ungrouped layers
  const ungroupedLayers = useMemo(
    () => sortedLayers.filter((l) => l.groupId === null),
    [sortedLayers]
  );

  // Get layers for a specific group - memoized per group
  const getLayersForGroup = useCallback(
    (groupId: string) => sortedLayers.filter((l) => l.groupId === groupId),
    [sortedLayers]
  );

  const handleCreateLayer = useCallback(() => {
    const name = `Layer ${layers.length + 1}`;
    const randomColor = {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256),
      a: 255,
    };
    // 作成も履歴に残す（残さないと、元に戻した並び順の値が新しいレイヤーの値と重なることがある）
    recordHistory(() => createLayer(name, randomColor));
  }, [layers.length, createLayer, recordHistory]);

  const handleCreateGroup = useCallback(() => {
    recordHistory(() => createLayerGroup(`Group ${layerGroups.length + 1}`));
  }, [layerGroups.length, createLayerGroup, recordHistory]);

  const handleMergeSimilar = useCallback((options: { thresholdValue: number; applyNoise: boolean }) => {
    mergeSimilarLayersAction({ thresholdValue: options.thresholdValue, applyNoise: options.applyNoise });
  }, [mergeSimilarLayersAction]);

  // Drag handlers - memoized
  const handleDragStart = useCallback((e: React.DragEvent, id: string, type: 'layer' | 'group' = 'layer') => {
    draggedItem = { type, id };
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    draggedItem = null;
  }, []);

  // 同じグループ（またはグループなし）のレイヤーを、手前から順に order 0, 1, 2... として並べ直す
  const applyLayerSequence = useCallback((sequence: Layer[], groupId: string | null) => {
    sequence.forEach((l, i) => {
      if (l.order !== i || l.groupId !== groupId) {
        reorderLayer(l.id, i, groupId);
      }
    });
  }, [reorderLayer]);

  const handleLayerDrop = useCallback((e: React.DragEvent, targetId: string, position: 'before' | 'after') => {
    if (!draggedItem || draggedItem.type !== 'layer') return;

    const draggedLayer = layers.find((l) => l.id === draggedItem!.id);
    const targetLayer = layers.find((l) => l.id === targetId);
    if (!draggedLayer || !targetLayer) return;

    // Skip if dropping on itself
    if (draggedLayer.id === targetLayer.id) return;

    const sourceGroupId = draggedLayer.groupId;
    const targetGroupId = targetLayer.groupId;

    // 移動先のグループでの新しい並び（手前から）
    const current = sortedLayers.filter((l) => l.groupId === targetGroupId);
    const next = current.filter((l) => l.id !== draggedLayer.id);
    const targetIndex = next.findIndex((l) => l.id === targetLayer.id);
    next.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, draggedLayer);

    // 並びが変わらないなら何もしない（番号の振り直しだけの履歴を残さない）
    if (sourceGroupId === targetGroupId && next.every((l, i) => l.id === current[i].id)) return;

    // 移動と番号の振り直しをまとめて 1 回の操作として履歴に記録する
    recordHistory(() => {
      applyLayerSequence(next, targetGroupId);
      // グループ間の移動なら、移動元のグループも振り直す
      if (sourceGroupId !== targetGroupId) {
        applyLayerSequence(
          sortedLayers.filter((l) => l.groupId === sourceGroupId && l.id !== draggedLayer.id),
          sourceGroupId
        );
      }
    });
  }, [layers, sortedLayers, applyLayerSequence, recordHistory]);

  const handleLayerToGroupDrop = useCallback((e: React.DragEvent, groupId: string) => {
    if (!draggedItem || draggedItem.type !== 'layer') return;
    const layer = layers.find((l) => l.id === draggedItem!.id);
    // すでにそのグループにあるなら何もしない（末尾へ回さない）
    if (!layer || layer.groupId === groupId) return;
    recordHistory(() => moveLayerToGroup(layer.id, groupId));
  }, [layers, moveLayerToGroup, recordHistory]);

  // Handle dropping a layer outside of a group (before/after group in the list)
  const handleLayerDropOutsideGroup = useCallback((e: React.DragEvent, position: 'before' | 'after', referenceGroupId: string) => {
    if (!draggedItem || draggedItem.type !== 'layer') return;

    const draggedLayer = layers.find((l) => l.id === draggedItem!.id);
    if (!draggedLayer) return;
    if (!layerGroups.some((g) => g.id === referenceGroupId)) return;

    // グループの外（グループなしのレイヤー）の先頭または末尾へ移す
    const current = sortedLayers.filter((l) => l.groupId === null);
    const others = current.filter((l) => l.id !== draggedLayer.id);
    const next = position === 'before' ? [draggedLayer, ...others] : [...others, draggedLayer];
    if (draggedLayer.groupId === null && next.every((l, i) => l.id === current[i].id)) return;

    recordHistory(() => applyLayerSequence(next, null));
  }, [layers, layerGroups, sortedLayers, applyLayerSequence, recordHistory]);

  const handleGroupReorderDrop = useCallback((e: React.DragEvent, targetGroupId: string, position: 'before' | 'after') => {
    if (!draggedItem || draggedItem.type !== 'group') return;

    const draggedGroup = layerGroups.find((g) => g.id === draggedItem!.id);
    if (!draggedGroup || draggedGroup.id === targetGroupId) return;

    // 新しいグループの並び（手前から）
    const next = sortedGroups.filter((g) => g.id !== draggedGroup.id);
    const targetIndex = next.findIndex((g) => g.id === targetGroupId);
    if (targetIndex === -1) return;
    next.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, draggedGroup);
    if (next.every((g, i) => g.id === sortedGroups[i].id)) return;

    recordHistory(() => {
      next.forEach((g, i) => {
        if (g.order !== i) {
          reorderLayerGroup(g.id, i);
        }
      });
    });
  }, [layerGroups, sortedGroups, reorderLayerGroup, recordHistory]);

  const handleDropOutsideGroup = useCallback((e: React.DragEvent) => {
    if (draggedItem && draggedItem.type === 'layer') {
      const layer = layers.find((l) => l.id === draggedItem!.id);
      if (layer && layer.groupId !== null) {
        recordHistory(() => moveLayerToGroup(layer.id, null));
      }
    }
    // 移動でドラッグ元の要素が作り直されると dragend が届かないので、ドロップ時にも解除する
    draggedItem = null;
  }, [layers, moveLayerToGroup, recordHistory]);

  // Shared dialog handlers
  const handleOpenDetailDialog = useCallback((layerId: string) => {
    setDetailDialogLayerId(layerId);
  }, []);

  const handleOpenGroupDetailDialog = useCallback((groupId: string) => {
    setDetailDialogGroupId(groupId);
  }, []);

  const handleOpenMergeDialog = useCallback((layerId: string) => {
    setMergeSourceLayerId(layerId);
  }, []);

  const handleOpenDeleteDialog = useCallback((layerId: string, layerName: string) => {
    setDeleteDialogState({ layerId, layerName });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteDialogState) {
      const { layerId } = deleteDialogState;
      recordHistory(() => deleteLayer(layerId));
      setDeleteDialogState(null);
    }
  }, [deleteDialogState, deleteLayer, recordHistory]);

  // Calculate width style
  const widthStyle = width !== undefined ? { width: `${width}px` } : undefined;
  const widthClass = width !== undefined ? '' : 'w-72';

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`flex h-full flex-col border-r border-border bg-card ${widthClass}`} style={widthStyle}>
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">レイヤー</h2>
            <div className="flex gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCreateLayer}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>レイヤーを追加</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCreateGroup}
                  >
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>グループを作成</p>
                </TooltipContent>
              </Tooltip>
              {layers.length > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setMergeDialogOpen(true)}
                    >
                      <Merge className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>類似レイヤーを統合</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {activeLayerId
              ? 'キャンバスをクリックして描画'
              : layers.length === 0
                ? 'キャンバスに直接描画、またはレイヤーを作成'
                : 'レイヤーを選択して描画を開始'}
          </p>
        </div>

      <div
        className="flex-1 overflow-auto p-4"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={handleDropOutsideGroup}
      >
        <div className="flex flex-col gap-2">
          {/* Render groups with their layers */}
          {sortedGroups.map((group) => (
            <LayerGroupItem
              key={group.id}
              group={group}
              onDragStart={(e, id) => handleDragStart(e, id, 'group')}
              onDragEnd={handleDragEnd}
              onLayerDrop={handleLayerToGroupDrop}
              onLayerDropOutside={handleLayerDropOutsideGroup}
              onGroupDrop={handleGroupReorderDrop}
              onOpenDetailDialog={handleOpenGroupDetailDialog}
            >
              {getLayersForGroup(group.id).map((layer) => (
                <LayerItem
                  key={layer.id}
                  layerId={layer.id}
                  onDragStart={(e, id) => handleDragStart(e, id, 'layer')}
                  onDragEnd={handleDragEnd}
                  onDrop={handleLayerDrop}
                  onOpenDetailDialog={handleOpenDetailDialog}
                  onOpenMergeDialog={handleOpenMergeDialog}
                  onOpenDeleteDialog={handleOpenDeleteDialog}
                />
              ))}
              {getLayersForGroup(group.id).length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  ここにレイヤーをドラッグ
                </p>
              )}
            </LayerGroupItem>
          ))}

          {/* Render ungrouped layers */}
          {ungroupedLayers.map((layer) => (
            <LayerItem
              key={layer.id}
              layerId={layer.id}
              onDragStart={(e, id) => handleDragStart(e, id, 'layer')}
              onDragEnd={handleDragEnd}
              onDrop={handleLayerDrop}
              onOpenDetailDialog={handleOpenDetailDialog}
              onOpenMergeDialog={handleOpenMergeDialog}
              onOpenDeleteDialog={handleOpenDeleteDialog}
            />
          ))}

          {/* Empty state */}
          {layers.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-center text-xs text-muted-foreground">
                レイヤーを作成して色を整理できます
              </p>
            </div>
          )}
        </div>
      </div>

      <GenerateOptionsDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        onGenerate={handleMergeSimilar}
        title="類似レイヤーを統合"
        description="類似色のレイヤーを統合します。"
      />

      {/* Shared dialogs - single instance for all layers/groups */}
      {detailDialogLayerId && (
        <LayerDetailDialog
          open={true}
          onOpenChange={(open) => !open && setDetailDialogLayerId(null)}
          layerId={detailDialogLayerId}
        />
      )}

      {detailDialogGroupId && (
        <LayerGroupDetailDialog
          open={true}
          onOpenChange={(open) => !open && setDetailDialogGroupId(null)}
          groupId={detailDialogGroupId}
        />
      )}

      {mergeSourceLayerId && (
        <MergeDialog
          open={true}
          onOpenChange={(open) => !open && setMergeSourceLayerId(null)}
          sourceLayerId={mergeSourceLayerId}
        />
      )}

      <AlertDialog open={!!deleteDialogState} onOpenChange={(open) => !open && setDeleteDialogState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>レイヤーを削除</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteDialogState?.layerName}」を削除しますか？このレイヤーに属するすべてのピクセルが消去されます（元に戻す（Ctrl/⌘+Z）で取り消せます）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

// Legacy export for backwards compatibility
export { LayerPanel as GroupPanel };
