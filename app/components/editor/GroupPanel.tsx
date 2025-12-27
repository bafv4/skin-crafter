import { useState } from 'react';
import { Plus, Trash2, Wand2, Sparkles, Merge, GitMerge, Scissors, RefreshCw, Blend } from 'lucide-react';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Label } from '@components/ui/label';
import { Slider } from '@components/ui/slider';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { Checkbox } from '@components/ui/checkbox';
import { useEditorStore, type MaterialType } from '../../stores/editorStore';
import { rgbaToHex, hexToRgba, type RGBA } from '../../types/editor';
import { type ColorThresholdPreset } from '../../lib/groupGenerator';

// Material options for noise generation
const MATERIAL_OPTIONS: { value: MaterialType; label: string; description: string }[] = [
  { value: 'other', label: 'Other', description: 'Standard noise pattern' },
  { value: 'hair', label: 'Hair', description: 'Dark streaks with warm tones for hair strands' },
  { value: 'cloth', label: 'Cloth', description: 'Fabric-like texture with subtle fading' },
  { value: 'skin', label: 'Skin', description: 'Soft variation with warm undertones' },
  { value: 'metal', label: 'Metal', description: 'High contrast with specular highlights' },
  { value: 'plastic', label: 'Plastic', description: 'Smooth, uniform glossy surface' },
];

const THRESHOLD_OPTIONS: { value: ColorThresholdPreset; label: string; description: string }[] = [
  { value: 'strict', label: 'Strict', description: 'Very similar colors only (15)' },
  { value: 'normal', label: 'Normal', description: 'Balanced (30)' },
  { value: 'loose', label: 'Loose', description: 'More variation allowed (50)' },
  { value: 'veryLoose', label: 'Very Loose', description: 'Large differences allowed (80)' },
];

// Threshold preset markers for slider
const THRESHOLD_PRESETS = [
  { value: 15, label: 'Strict' },
  { value: 30, label: 'Normal' },
  { value: 50, label: 'Loose' },
  { value: 80, label: 'Very Loose' },
];

// Simple color picker component
function ColorPicker({
  color,
  onChange,
}: {
  color: RGBA;
  onChange: (color: RGBA) => void;
}) {
  const hexColor = rgbaToHex(color);

  return (
    <div className="flex flex-col gap-2">
      <input
        type="color"
        value={hexColor}
        onChange={(e) => onChange(hexToRgba(e.target.value, color.a))}
        className="h-10 w-full cursor-pointer rounded border border-border"
      />
      <Input
        value={hexColor}
        onChange={(e) => {
          const hex = e.target.value;
          if (/^#[0-9a-f]{6}$/i.test(hex)) {
            onChange(hexToRgba(hex, color.a));
          }
        }}
        placeholder="#000000"
        className="font-mono text-sm"
      />
    </div>
  );
}

// Auto-generate options dialog
function GenerateOptionsDialog({
  open,
  onOpenChange,
  onGenerate,
  title = 'Auto-generate Groups',
  description = 'Generate groups from pixel colors with similar colors grouped together.',
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
    if (value <= 15) return 'Strict';
    if (value <= 30) return 'Normal';
    if (value <= 50) return 'Loose';
    return 'Very Loose';
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
              <Label>Color Similarity Threshold</Label>
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
              <span>More groups</span>
              <span>Fewer groups</span>
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
              Apply noise based on threshold
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            When enabled, merged color variations are compensated with noise to preserve visual detail.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate}>Generate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Merge target selection dialog
function MergeDialog({
  open,
  onOpenChange,
  sourceGroupId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceGroupId: string;
}) {
  const { groups, mergeGroupsById } = useEditorStore();
  const [targetGroupId, setTargetGroupId] = useState<string>('');

  const sourceGroup = groups.find((g) => g.id === sourceGroupId);
  const otherGroups = groups.filter((g) => g.id !== sourceGroupId);

  const handleMerge = () => {
    if (targetGroupId) {
      mergeGroupsById(sourceGroupId, targetGroupId);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Merge Group</DialogTitle>
          <DialogDescription>
            Merge "{sourceGroup?.name}" into another group. All pixels will be reassigned.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>Target Group</Label>
            <Select value={targetGroupId} onValueChange={setTargetGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a group..." />
              </SelectTrigger>
              <SelectContent>
                {otherGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: rgbaToHex(group.baseColor) }}
                      />
                      <span>{group.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={!targetGroupId}>
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Split group dialog
function SplitDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
}) {
  const splitGroupByColorAction = useEditorStore((state) => state.splitGroupByColorAction);
  const [threshold, setThreshold] = useState<ColorThresholdPreset>('strict');
  const [applyNoise, setApplyNoise] = useState(false);

  const handleSplit = () => {
    splitGroupByColorAction(groupId, { threshold, applyNoise });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Split Group - {groupName}</DialogTitle>
          <DialogDescription>
            Split this group into multiple groups based on color differences within the group.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>Color Similarity Threshold</Label>
            <Select value={threshold} onValueChange={(v) => setThreshold(v as ColorThresholdPreset)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THRESHOLD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Lower threshold = more splits, finer color separation
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="split-apply-noise"
              checked={applyNoise}
              onCheckedChange={(checked) => setApplyNoise(checked === true)}
            />
            <Label htmlFor="split-apply-noise" className="cursor-pointer">
              Apply noise to new groups
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSplit}>Split</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Noise settings dialog
function NoiseDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
}) {
  const { groups, applyNoise } = useEditorStore();
  const group = groups.find((g) => g.id === groupId);

  // Sliders now range from -100 to +100 (0 = no effect)
  const [brightness, setBrightness] = useState(group?.noiseSettings.brightness ?? 0);
  const [hue, setHue] = useState(group?.noiseSettings.hue ?? 0);
  const [material, setMaterial] = useState<MaterialType>('other');

  const handleApply = () => {
    // Convert signed value to absolute + direction for the store
    const brightnessDir = brightness >= 0 ? 'positive' : 'negative';
    const hueDir = hue >= 0 ? 'positive' : 'negative';
    applyNoise(groupId, Math.abs(brightness), Math.abs(hue), brightnessDir, hueDir, material);
    onOpenChange(false);
  };

  const handleRegenerate = () => {
    // Re-apply noise with same settings to generate new random pattern
    const brightnessDir = brightness >= 0 ? 'positive' : 'negative';
    const hueDir = hue >= 0 ? 'positive' : 'negative';
    applyNoise(groupId, Math.abs(brightness), Math.abs(hue), brightnessDir, hueDir, material);
  };

  // Format display text
  const formatValue = (val: number) => {
    if (val > 0) return `+${val}%`;
    if (val < 0) return `${val}%`;
    return '0%';
  };

  const selectedMaterial = MATERIAL_OPTIONS.find((m) => m.value === material);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Apply Noise - {groupName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6 py-4">
          <div className="flex flex-col gap-2">
            <Label>Material</Label>
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
              <Label>Brightness</Label>
              <span className="text-sm text-muted-foreground">{formatValue(brightness)}</span>
            </div>
            <Slider
              value={[brightness]}
              onValueChange={([v]) => setBrightness(v)}
              min={-100}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Darker</span>
              <span>Lighter</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>Hue Shift</Label>
              <span className="text-sm text-muted-foreground">{formatValue(hue)}</span>
            </div>
            <Slider
              value={[hue]}
              onValueChange={([v]) => setHue(v)}
              min={-100}
              max={100}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Cooler</span>
              <span>Warmer</span>
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
            Re-generate
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Blend borders dialog
function BlendDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId?: string;
  groupName?: string;
}) {
  const blendBordersAction = useEditorStore((state) => state.blendBordersAction);
  const [strength, setStrength] = useState(15);

  const handleApply = () => {
    blendBordersAction(strength, groupId);
    onOpenChange(false);
  };

  const title = groupId ? `Blend Borders - ${groupName}` : 'Blend All Borders';
  const description = groupId
    ? 'Blend pixels at this group\'s boundaries to create smoother color transitions.'
    : 'Blend pixels at all group boundaries to create smoother color transitions.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>Blend Strength</Label>
              <span className="text-sm text-muted-foreground">{strength}%</span>
            </div>
            <Slider
              value={[strength]}
              onValueChange={([v]) => setStrength(v)}
              min={5}
              max={50}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Subtle</span>
              <span>Strong</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Group item component - optimized with individual selectors
function GroupItem({ groupId }: { groupId: string }) {
  // Use individual selectors to minimize re-renders
  const group = useEditorStore((state) => state.groups.find((g) => g.id === groupId));
  const activeGroupId = useEditorStore((state) => state.activeGroupId);
  const groupCount = useEditorStore((state) => state.groups.length);
  const setActiveGroup = useEditorStore((state) => state.setActiveGroup);
  const setHighlightedGroup = useEditorStore((state) => state.setHighlightedGroup);
  const updateGroupColor = useEditorStore((state) => state.updateGroupColor);
  const updateGroupName = useEditorStore((state) => state.updateGroupName);
  const deleteGroup = useEditorStore((state) => state.deleteGroup);

  const [noiseDialogOpen, setNoiseDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [blendDialogOpen, setBlendDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group?.name ?? '');
  const canMerge = groupCount > 1;

  if (!group) return null;

  const isActive = activeGroupId === groupId;

  const handleNameSubmit = () => {
    if (editName.trim()) {
      updateGroupName(groupId, editName.trim());
    }
    setIsEditing(false);
  };

  return (
    <>
      <div
        className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:border-muted-foreground/50 ${
          isActive
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card'
        }`}
        onClick={() => setActiveGroup(groupId)}
        onMouseEnter={() => setHighlightedGroup(groupId)}
        onMouseLeave={() => setHighlightedGroup(null)}
      >
        {/* Top row: Color picker and name */}
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="h-6 w-6 shrink-0 rounded border border-border"
                style={{ backgroundColor: rgbaToHex(group.baseColor) }}
                onClick={(e) => e.stopPropagation()}
              />
            </PopoverTrigger>
            <PopoverContent className="w-48" onClick={(e) => e.stopPropagation()}>
              <ColorPicker
                color={group.baseColor}
                onChange={(color) => updateGroupColor(groupId, color)}
              />
            </PopoverContent>
          </Popover>

          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') setIsEditing(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-sm"
              autoFocus
            />
          ) : (
            <span
              className="flex-1 text-sm font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditName(group.name);
                setIsEditing(true);
              }}
            >
              {group.name}
            </span>
          )}
        </div>

        {/* Bottom row: Action buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setNoiseDialogOpen(true);
            }}
            title="Apply Noise"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setBlendDialogOpen(true);
            }}
            title="Blend borders"
          >
            <Blend className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setSplitDialogOpen(true);
            }}
            title="Split group by color"
          >
            <Scissors className="h-3.5 w-3.5" />
          </Button>

          {canMerge && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setMergeDialogOpen(true);
              }}
              title="Merge into another group"
            >
              <GitMerge className="h-3.5 w-3.5" />
            </Button>
          )}

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              deleteGroup(groupId);
            }}
            title="Delete Group"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {(group.noiseSettings.brightness > 0 || group.noiseSettings.hue > 0) && (
          <div className="flex gap-2 text-xs text-muted-foreground">
            {group.noiseSettings.brightness > 0 && (
              <span>Brightness: {group.noiseSettings.brightness}%</span>
            )}
            {group.noiseSettings.hue > 0 && (
              <span>Hue: {group.noiseSettings.hue}%</span>
            )}
          </div>
        )}
      </div>

      <NoiseDialog
        open={noiseDialogOpen}
        onOpenChange={setNoiseDialogOpen}
        groupId={groupId}
        groupName={group.name}
      />

      <MergeDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        sourceGroupId={groupId}
      />

      <SplitDialog
        open={splitDialogOpen}
        onOpenChange={setSplitDialogOpen}
        groupId={groupId}
        groupName={group.name}
      />

      <BlendDialog
        open={blendDialogOpen}
        onOpenChange={setBlendDialogOpen}
        groupId={groupId}
        groupName={group.name}
      />
    </>
  );
}

export function GroupPanel() {
  const { groups, pixels, createGroup, generateGroups, mergeSimilarGroupsAction, activeGroupId, drawingColor, setDrawingColor } = useEditorStore();
  const [newGroupName, setNewGroupName] = useState('');
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [blendDialogOpen, setBlendDialogOpen] = useState(false);

  // Check if there are any non-transparent pixels without a group
  const hasUngroupedPixels = pixels.some((row) =>
    row.some((pixel) => pixel.color.a > 0 && pixel.groupId === null)
  );

  const handleCreateGroup = () => {
    const name = newGroupName.trim() || `Group ${groups.length + 1}`;
    // Generate a random color
    const randomColor = {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256),
      a: 255,
    };
    createGroup(name, randomColor);
    setNewGroupName('');
  };

  const handleGenerate = (options: { thresholdValue: number; applyNoise: boolean }) => {
    generateGroups({ thresholdValue: options.thresholdValue, applyNoise: options.applyNoise });
  };

  const handleMergeSimilar = (options: { thresholdValue: number; applyNoise: boolean }) => {
    mergeSimilarGroupsAction({ thresholdValue: options.thresholdValue, applyNoise: options.applyNoise });
  };

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Groups</h2>
          <div className="flex gap-1">
            {groups.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setBlendDialogOpen(true)}
                title="Blend group borders"
              >
                <Blend className="h-3 w-3" />
                Blend
              </Button>
            )}
            {groups.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setMergeDialogOpen(true)}
                title="Merge similar groups"
              >
                <Merge className="h-3 w-3" />
                Merge
              </Button>
            )}
            {hasUngroupedPixels && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setGenerateDialogOpen(true)}
              >
                <Sparkles className="h-3 w-3" />
                Auto-generate
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {activeGroupId
            ? 'Click on canvas to paint with selected group'
            : groups.length === 0
              ? 'Draw directly with the color below, or create groups'
              : hasUngroupedPixels
                ? 'Generate groups from imported skin or create manually'
                : 'Select a group to start painting'}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <GroupItem key={group.id} groupId={group.id} />
          ))}

          {groups.length === 0 && (
            <div className="flex flex-col gap-4 py-4">
              <div className="rounded-lg border border-border p-3">
                <Label className="text-xs text-muted-foreground mb-2 block">Direct Drawing Color</Label>
                <ColorPicker color={drawingColor} onChange={setDrawingColor} />
                <p className="text-xs text-muted-foreground mt-2">
                  Draw directly on canvas without groups
                </p>
              </div>
              <div className="flex flex-col items-center gap-2 pt-2">
                <p className="text-center text-xs text-muted-foreground">
                  Or create groups to organize your colors
                </p>
                {hasUngroupedPixels && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setGenerateDialogOpen(true)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Auto-generate Groups
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <GenerateOptionsDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        onGenerate={handleGenerate}
        title="Auto-generate Groups"
        description="Generate groups from pixel colors with similar colors grouped together."
      />

      <GenerateOptionsDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        onGenerate={handleMergeSimilar}
        title="Merge Similar Groups"
        description="Merge existing groups that have similar base colors."
      />

      <BlendDialog
        open={blendDialogOpen}
        onOpenChange={setBlendDialogOpen}
      />

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
            placeholder="New group name..."
            className="flex-1"
          />
          <Button size="icon" onClick={handleCreateGroup}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
