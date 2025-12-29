import { useState, memo, useCallback, useMemo, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Plus, Trash2, Wand2, Merge, GitMerge, RefreshCw, GripVertical, ChevronRight, ChevronDown, FolderPlus, Palette, PaintBucket, Settings2, Eye, EyeOff, Copy, MoreHorizontal } from 'lucide-react';
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
import { rgbaToHex, type RGBA, type LayerGroup, type MaterialType } from '../../types/editor';

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
  const updateLayerName = useEditorStore((state) => state.updateLayerName);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <Label>基本色</Label>
              <div className="p-3 border rounded-lg">
                <ColorPicker
                  color={layer.baseColor}
                  onChange={(color) => updateLayerColor(layerId, color)}
                />
              </div>
            </div>
          )}

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
  const toggleLayerVisibility = useEditorStore((state) => state.toggleLayerVisibility);
  const duplicateLayer = useEditorStore((state) => state.duplicateLayer);

  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
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
          draggable
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

          <span className="flex-1 text-sm font-medium truncate">
            {layer.name}
          </span>
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
  const toggleLayerGroupVisibility = useEditorStore((state) => state.toggleLayerGroupVisibility);

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
          draggable
          onDragStart={(e) => onDragStart?.(e, group.id, 'group')}
          onDragEnd={onDragEnd}
        >
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" />
        <button
          onClick={() => toggleLayerGroupCollapsed(group.id)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          {group.collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
          <span className="text-sm font-medium truncate">
            {group.name}
          </span>
        </button>

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
                onClick={() => deleteLayerGroup(group.id)}
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
  const layers = useEditorStore((state) => state.layers);
  const layerGroups = useEditorStore((state) => state.layerGroups);
  const activeLayerId = useEditorStore((state) => state.activeLayerId);
  const createLayer = useEditorStore((state) => state.createLayer);
  const createLayerGroup = useEditorStore((state) => state.createLayerGroup);
  const mergeSimilarLayersAction = useEditorStore((state) => state.mergeSimilarLayersAction);
  const reorderLayer = useEditorStore((state) => state.reorderLayer);
  const reorderLayerGroup = useEditorStore((state) => state.reorderLayerGroup);
  const moveLayerToGroup = useEditorStore((state) => state.moveLayerToGroup);
  const deleteLayer = useEditorStore((state) => state.deleteLayer);

  // Shared dialog state - single dialogs instead of per-layer dialogs
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [detailDialogLayerId, setDetailDialogLayerId] = useState<string | null>(null);
  const [detailDialogGroupId, setDetailDialogGroupId] = useState<string | null>(null);
  const [mergeSourceLayerId, setMergeSourceLayerId] = useState<string | null>(null);
  const [deleteDialogState, setDeleteDialogState] = useState<{ layerId: string; layerName: string } | null>(null);

  // Memoize sorted layers and groups
  const sortedLayers = useMemo(
    () => [...layers].sort((a, b) => a.order - b.order),
    [layers]
  );
  const sortedGroups = useMemo(
    () => [...layerGroups].sort((a, b) => a.order - b.order),
    [layerGroups]
  );

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
    createLayer(name, randomColor);
  }, [layers.length, createLayer]);

  const handleCreateGroup = useCallback(() => {
    createLayerGroup(`Group ${layerGroups.length + 1}`);
  }, [layerGroups.length, createLayerGroup]);

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

  const handleLayerDrop = useCallback((e: React.DragEvent, targetId: string, position: 'before' | 'after') => {
    if (!draggedItem || draggedItem.type !== 'layer') return;

    const draggedLayer = layers.find((l) => l.id === draggedItem!.id);
    const targetLayer = layers.find((l) => l.id === targetId);
    if (!draggedLayer || !targetLayer) return;

    // Skip if dropping on itself
    if (draggedLayer.id === targetLayer.id) return;

    const sourceGroupId = draggedLayer.groupId;
    const targetGroupId = targetLayer.groupId;

    // Calculate new order in the target group
    const targetGroupLayers = layers
      .filter((l) => l.groupId === targetGroupId && l.id !== draggedLayer.id)
      .sort((a, b) => a.order - b.order);

    let newOrder: number;
    const targetIndex = targetGroupLayers.findIndex((l) => l.id === targetLayer.id);

    if (position === 'before') {
      if (targetIndex === 0) {
        newOrder = targetGroupLayers[0].order - 1;
      } else {
        newOrder = (targetGroupLayers[targetIndex - 1].order + targetGroupLayers[targetIndex].order) / 2;
      }
    } else {
      if (targetIndex === targetGroupLayers.length - 1) {
        newOrder = targetGroupLayers[targetIndex].order + 1;
      } else {
        newOrder = (targetGroupLayers[targetIndex].order + targetGroupLayers[targetIndex + 1].order) / 2;
      }
    }

    // Move the layer to the new position
    reorderLayer(draggedItem.id, newOrder, targetGroupId);

    // Re-normalize orders in target group (including the moved layer)
    const updatedTargetLayers = layers
      .filter((l) => l.groupId === targetGroupId || l.id === draggedItem!.id)
      .map((l) => (l.id === draggedItem!.id ? { ...l, order: newOrder, groupId: targetGroupId } : l))
      .filter((l) => l.groupId === targetGroupId)
      .sort((a, b) => a.order - b.order);

    updatedTargetLayers.forEach((l, i) => {
      if (l.order !== i) {
        reorderLayer(l.id, i, targetGroupId);
      }
    });

    // If moving between groups, re-normalize source group
    if (sourceGroupId !== targetGroupId) {
      const sourceGroupLayers = layers
        .filter((l) => l.groupId === sourceGroupId && l.id !== draggedItem!.id)
        .sort((a, b) => a.order - b.order);

      sourceGroupLayers.forEach((l, i) => {
        if (l.order !== i) {
          reorderLayer(l.id, i, sourceGroupId);
        }
      });
    }
  }, [layers, reorderLayer]);

  const handleLayerToGroupDrop = useCallback((e: React.DragEvent, groupId: string) => {
    if (!draggedItem || draggedItem.type !== 'layer') return;
    moveLayerToGroup(draggedItem.id, groupId);
  }, [moveLayerToGroup]);

  // Handle dropping a layer outside of a group (before/after group in the list)
  const handleLayerDropOutsideGroup = useCallback((e: React.DragEvent, position: 'before' | 'after', referenceGroupId: string) => {
    if (!draggedItem || draggedItem.type !== 'layer') return;

    const draggedLayer = layers.find((l) => l.id === draggedItem!.id);
    if (!draggedLayer) return;

    // Move layer out of any group (set groupId to null)
    // Calculate order based on ungrouped layers
    const ungroupedLayers = layers
      .filter((l) => l.groupId === null && l.id !== draggedItem!.id)
      .sort((a, b) => a.order - b.order);

    // Find the reference group's order to determine where to place the layer
    const referenceGroup = layerGroups.find((g) => g.id === referenceGroupId);
    if (!referenceGroup) return;

    // For now, place at the beginning or end of ungrouped layers based on position
    let newOrder: number;
    if (position === 'before') {
      // Place before all ungrouped layers (at the top)
      newOrder = ungroupedLayers.length > 0 ? ungroupedLayers[0].order - 1 : 0;
    } else {
      // Place after all ungrouped layers (at the bottom)
      newOrder = ungroupedLayers.length > 0 ? ungroupedLayers[ungroupedLayers.length - 1].order + 1 : 0;
    }

    // First move to null group, then reorder
    reorderLayer(draggedItem.id, newOrder, null);

    // Re-normalize orders for ungrouped layers
    const updatedUngroupedLayers = layers
      .filter((l) => l.groupId === null || l.id === draggedItem!.id)
      .map((l) => (l.id === draggedItem!.id ? { ...l, order: newOrder, groupId: null } : l))
      .filter((l) => l.groupId === null)
      .sort((a, b) => a.order - b.order);

    updatedUngroupedLayers.forEach((l, i) => {
      if (l.order !== i) {
        reorderLayer(l.id, i, null);
      }
    });
  }, [layers, layerGroups, reorderLayer]);

  const handleGroupReorderDrop = useCallback((e: React.DragEvent, targetGroupId: string, position: 'before' | 'after') => {
    if (!draggedItem || draggedItem.type !== 'group') return;

    const draggedGroup = layerGroups.find((g) => g.id === draggedItem!.id);
    const targetGroup = layerGroups.find((g) => g.id === targetGroupId);
    if (!draggedGroup || !targetGroup || draggedGroup.id === targetGroup.id) return;

    // Calculate new order
    const targetOrder = targetGroup.order;
    const newOrder = position === 'before' ? targetOrder - 0.5 : targetOrder + 0.5;

    reorderLayerGroup(draggedItem.id, newOrder);

    // Re-normalize orders
    const updatedGroups = layerGroups
      .map((g) => (g.id === draggedItem!.id ? { ...g, order: newOrder } : g))
      .sort((a, b) => a.order - b.order);

    updatedGroups.forEach((g, i) => {
      if (g.order !== i) {
        reorderLayerGroup(g.id, i);
      }
    });
  }, [layerGroups, reorderLayerGroup]);

  const handleDropOutsideGroup = useCallback((e: React.DragEvent) => {
    if (!draggedItem || draggedItem.type !== 'layer') return;
    const layer = layers.find((l) => l.id === draggedItem!.id);
    if (layer && layer.groupId !== null) {
      moveLayerToGroup(draggedItem.id, null);
    }
  }, [layers, moveLayerToGroup]);

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
      deleteLayer(deleteDialogState.layerId);
      setDeleteDialogState(null);
    }
  }, [deleteDialogState, deleteLayer]);

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
              「{deleteDialogState?.layerName}」を削除しますか？このレイヤーに属するすべてのピクセルが消去されます。この操作は元に戻せません。
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
