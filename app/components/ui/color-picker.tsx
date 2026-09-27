import { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, X, Pencil } from 'lucide-react';
import { Input } from './input';
import { Label } from './label';
import { Button } from './button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';
import { type RGBA, type PaletteColor, rgbaToHex, hexToRgba } from '../../types/editor';
import { useEditorStore } from '../../stores/editorStore';

interface HSV {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }

  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  s /= 100;
  v /= 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// 色エリア・スライダー共通のドラッグ処理。
// onPoint にはコンテナ内の相対位置（0〜1）を渡す。
// ドラッグ終了時に onEnd を呼ぶ（ドラッグ中にアンマウントされた場合も呼び、履歴の確定漏れを防ぐ）
function usePointerDrag(onPoint: (x: number, y: number) => void, onEnd?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  useEffect(() => () => {
    if (isDragging.current) onEndRef.current?.();
  }, []);

  const emit = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onPoint(clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height));
  };

  const end = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    ref.current?.releasePointerCapture(e.pointerId);
    onEndRef.current?.();
  };

  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      isDragging.current = true;
      ref.current?.setPointerCapture(e.pointerId);
      emit(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (isDragging.current) emit(e);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

// Saturation-Value picker (2D gradient)
function SaturationValuePicker({
  hue,
  saturation,
  value,
  onChange,
  onChangeEnd,
}: {
  hue: number;
  saturation: number;
  value: number;
  onChange: (s: number, v: number) => void;
  onChangeEnd?: () => void;
}) {
  const drag = usePointerDrag((x, y) => onChange(x * 100, (1 - y) * 100), onChangeEnd);
  const hueColor = `hsl(${hue}, 100%, 50%)`;

  return (
    <div
      {...drag}
      className="relative h-32 w-full cursor-crosshair rounded border border-border"
      style={{
        background: `
          linear-gradient(to top, #000, transparent),
          linear-gradient(to right, #fff, ${hueColor})
        `,
      }}
    >
      <div
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
        style={{
          left: `${saturation}%`,
          top: `${100 - value}%`,
        }}
      />
    </div>
  );
}

// Hue slider
function HueSlider({
  hue,
  onChange,
  onChangeEnd,
}: {
  hue: number;
  onChange: (h: number) => void;
  onChangeEnd?: () => void;
}) {
  const drag = usePointerDrag((x) => onChange(x * 360), onChangeEnd);

  return (
    <div
      {...drag}
      className="relative h-4 w-full cursor-pointer rounded border border-border"
      style={{
        background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
      }}
    >
      <div
        className="pointer-events-none absolute top-1/2 h-5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
        style={{
          left: `${(hue / 360) * 100}%`,
          backgroundColor: `hsl(${hue}, 100%, 50%)`,
        }}
      />
    </div>
  );
}

// Alpha slider
function AlphaSlider({
  alpha,
  color,
  onChange,
  onChangeEnd,
}: {
  alpha: number;
  color: { r: number; g: number; b: number };
  onChange: (a: number) => void;
  onChangeEnd?: () => void;
}) {
  const drag = usePointerDrag((x) => onChange(Math.round(x * 255)), onChangeEnd);
  const rgbStr = `${color.r}, ${color.g}, ${color.b}`;

  return (
    <div
      {...drag}
      className="relative h-4 w-full cursor-pointer rounded border border-border"
      style={{
        background: `
          linear-gradient(to right, transparent, rgb(${rgbStr})),
          repeating-conic-gradient(#808080 0% 25%, #fff 0% 50%) 50% / 8px 8px
        `,
      }}
    >
      <div
        className="pointer-events-none absolute top-1/2 h-5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
        style={{
          left: `${(alpha / 255) * 100}%`,
          backgroundColor: `rgba(${rgbStr}, ${alpha / 255})`,
        }}
      />
    </div>
  );
}

// Color Palette component
function ColorPalette({
  onSelectColor,
  currentColor,
}: {
  onSelectColor: (color: RGBA) => void;
  currentColor: RGBA;
}) {
  const palette = useEditorStore((state) => state.palette);
  const addToPalette = useEditorStore((state) => state.addToPalette);
  const removeFromPalette = useEditorStore((state) => state.removeFromPalette);
  const renamePaletteColor = useEditorStore((state) => state.renamePaletteColor);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 名前を編集中のパレット色
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');

  const editingColor = palette.find((p) => p.id === editingId) ?? null;
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 名前入力中の Esc は入力のキャンセルだけにする。
  // Radix の Popover/Dialog は document のキャプチャフェーズで Esc を拾って閉じてしまうため、
  // それより先に走る window のキャプチャフェーズで止める
  useEffect(() => {
    if (!editingId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement === nameInputRef.current) {
        // Radix は defaultPrevented な Esc では閉じない
        e.preventDefault();
        setEditingId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [editingId]);

  const startEditing = (id: string, name = '') => {
    setEditingId(id);
    setNameInput(name);
  };

  const commitName = () => {
    if (editingId) {
      renamePaletteColor(editingId, nameInput);
    }
    setEditingId(null);
  };

  const handleAddCurrentColor = () => {
    // 追加直後に名前を入力できるようにする（空のままでも可）
    startEditing(addToPalette(currentColor));
  };

  const isSameColor = (c1: RGBA, c2: RGBA) =>
    c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && c1.a === c2.a;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">パレット</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={handleAddCurrentColor}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>現在の色をパレットに追加</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {palette.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            +ボタンで色を保存
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {palette.map((p) => {
              const hex = rgbaToHex(p.color);
              return (
              <div
                key={p.id}
                className="relative"
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={`h-6 w-6 rounded border transition-all ${
                        editingId === p.id
                          ? 'border-primary ring-2 ring-primary'
                          : isSameColor(p.color, currentColor)
                            ? 'border-primary ring-1 ring-primary'
                            : 'border-border hover:border-foreground/50'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={p.name ? `${p.name}（${hex}）` : hex}
                      onClick={() => onSelectColor(p.color)}
                      onDoubleClick={() => startEditing(p.id, p.name)}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {p.name && <>{p.name} </>}
                      <span className={p.name ? 'opacity-70' : undefined}>{hex}</span>
                    </p>
                  </TooltipContent>
                </Tooltip>
                {hoveredId === p.id && (
                  <>
                    <button
                      className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                      aria-label="パレットから削除"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromPalette(p.id);
                      }}
                    >
                      <X className="h-2 w-2" />
                    </button>
                    <button
                      className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-secondary text-secondary-foreground border border-border flex items-center justify-center"
                      aria-label="名前を編集"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(p.id, p.name);
                      }}
                    >
                      <Pencil className="h-2 w-2" />
                    </button>
                  </>
                )}
              </div>
              );
            })}
          </div>
        )}

        {/* 色の名前編集 */}
        {editingColor && (
          <div className="flex items-center gap-1.5">
            <div
              className="h-6 w-6 shrink-0 rounded border border-border"
              style={{ backgroundColor: rgbaToHex(editingColor.color) }}
            />
            <Input
              ref={nameInputRef}
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitName();
                }
              }}
              onBlur={commitName}
              placeholder={`名前（${rgbaToHex(editingColor.color)}）`}
              aria-label="色の名前"
              maxLength={32}
              className="h-7 text-xs"
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function ColorPicker({
  color,
  onChange,
  onChangeComplete,
  showAlpha = false,
  showPalette = true,
}: {
  color: RGBA;
  onChange: (color: RGBA) => void;
  // 1回の操作（ドラッグ終了・HEX確定・パレット選択）が完了したときに呼ばれる（履歴の確定用）
  onChangeComplete?: () => void;
  showAlpha?: boolean;
  showPalette?: boolean;
}) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color.r, color.g, color.b));
  const [hexInput, setHexInput] = useState(() => rgbaToHex(color));

  // 外部から色が変わったら表示を合わせる。
  // 今の HSV が表す色と同じなら（自分が出した変更の反映なので）HSV はそのまま保つ
  // （黒や灰色では色から色相・彩度が復元できず、つまみが飛んでしまうため）
  useEffect(() => {
    const current = hsvToRgb(hsv.h, hsv.s, hsv.v);
    if (current.r !== color.r || current.g !== color.g || current.b !== color.b) {
      setHsv(rgbToHsv(color.r, color.g, color.b));
    }
    const hex = rgbaToHex(color);
    setHexInput((input) => (input.toLowerCase() === hex ? input : hex));
  }, [color.r, color.g, color.b, color.a]);

  const updateFromHsv = useCallback(
    (newHsv: HSV, alpha = color.a) => {
      const rgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
      const newColor = { ...rgb, a: alpha };
      setHsv(newHsv);
      setHexInput(rgbaToHex(newColor));
      onChange(newColor);
    },
    [color.a, onChange]
  );

  const handleSaturationValueChange = useCallback(
    (s: number, v: number) => {
      updateFromHsv({ ...hsv, s, v });
    },
    [hsv, updateFromHsv]
  );

  const handleHueChange = useCallback(
    (h: number) => {
      updateFromHsv({ ...hsv, h });
    },
    [hsv, updateFromHsv]
  );

  const handleAlphaChange = useCallback(
    (a: number) => {
      onChange({ ...color, a });
    },
    [color, onChange]
  );

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setHexInput(hex);
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      const newColor = hexToRgba(hex, color.a);
      setHsv(rgbToHsv(newColor.r, newColor.g, newColor.b));
      onChange(newColor);
      onChangeComplete?.();
    }
  };

  const handlePaletteSelect = useCallback(
    (paletteColor: RGBA) => {
      setHsv(rgbToHsv(paletteColor.r, paletteColor.g, paletteColor.b));
      setHexInput(rgbaToHex(paletteColor));
      onChange({ ...paletteColor });
      onChangeComplete?.();
    },
    [onChange, onChangeComplete]
  );

  const currentRgb = hsvToRgb(hsv.h, hsv.s, hsv.v);

  return (
    <div className="flex flex-col gap-3">
      {/* Color preview */}
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 shrink-0 rounded border border-border"
          style={{
            backgroundColor: `rgba(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b}, ${color.a / 255})`,
            backgroundImage: showAlpha
              ? 'repeating-conic-gradient(#808080 0% 25%, #fff 0% 50%) 50% / 8px 8px'
              : undefined,
            backgroundBlendMode: showAlpha ? 'difference' : undefined,
          }}
        >
          {showAlpha && (
            <div
              className="h-full w-full rounded"
              style={{
                backgroundColor: `rgba(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b}, ${color.a / 255})`,
              }}
            />
          )}
        </div>
        <Input
          value={hexInput}
          onChange={handleHexChange}
          placeholder="#000000"
          className="font-mono text-sm flex-1"
        />
      </div>

      {/* Saturation-Value picker */}
      <SaturationValuePicker
        hue={hsv.h}
        saturation={hsv.s}
        value={hsv.v}
        onChange={handleSaturationValueChange}
        onChangeEnd={onChangeComplete}
      />

      {/* Hue slider */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Hue</Label>
        <HueSlider hue={hsv.h} onChange={handleHueChange} onChangeEnd={onChangeComplete} />
      </div>

      {/* Alpha slider */}
      {showAlpha && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Alpha ({Math.round((color.a / 255) * 100)}%)
          </Label>
          <AlphaSlider alpha={color.a} color={currentRgb} onChange={handleAlphaChange} onChangeEnd={onChangeComplete} />
        </div>
      )}

      {/* Color Palette */}
      {showPalette && (
        <ColorPalette
          onSelectColor={handlePaletteSelect}
          currentColor={color}
        />
      )}
    </div>
  );
}
