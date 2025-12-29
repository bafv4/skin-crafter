import { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
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

// Saturation-Value picker (2D gradient)
function SaturationValuePicker({
  hue,
  saturation,
  value,
  onChange,
}: {
  hue: number;
  saturation: number;
  value: number;
  onChange: (s: number, v: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      onChange(x * 100, (1 - y) * 100);
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    containerRef.current?.setPointerCapture(e.pointerId);
    handlePointerEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      handlePointerEvent(e);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const hueColor = `hsl(${hue}, 100%, 50%)`;

  return (
    <div
      ref={containerRef}
      className="relative h-32 w-full cursor-crosshair rounded border border-border"
      style={{
        background: `
          linear-gradient(to top, #000, transparent),
          linear-gradient(to right, #fff, ${hueColor})
        `,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
}: {
  hue: number;
  onChange: (h: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onChange(x * 360);
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    containerRef.current?.setPointerCapture(e.pointerId);
    handlePointerEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      handlePointerEvent(e);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-4 w-full cursor-pointer rounded border border-border"
      style={{
        background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
}: {
  alpha: number;
  color: { r: number; g: number; b: number };
  onChange: (a: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onChange(Math.round(x * 255));
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    containerRef.current?.setPointerCapture(e.pointerId);
    handlePointerEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      handlePointerEvent(e);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const rgbStr = `${color.r}, ${color.g}, ${color.b}`;

  return (
    <div
      ref={containerRef}
      className="relative h-4 w-full cursor-pointer rounded border border-border"
      style={{
        background: `
          linear-gradient(to right, transparent, rgb(${rgbStr})),
          repeating-conic-gradient(#808080 0% 25%, #fff 0% 50%) 50% / 8px 8px
        `,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
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
  const { palette, addToPalette, removeFromPalette } = useEditorStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleAddCurrentColor = () => {
    addToPalette(currentColor);
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
            {palette.map((p) => (
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
                        isSameColor(p.color, currentColor)
                          ? 'border-primary ring-1 ring-primary'
                          : 'border-border hover:border-foreground/50'
                      }`}
                      style={{ backgroundColor: rgbaToHex(p.color) }}
                      onClick={() => onSelectColor(p.color)}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{p.name || rgbaToHex(p.color)}</p>
                  </TooltipContent>
                </Tooltip>
                {hoveredId === p.id && (
                  <button
                    className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromPalette(p.id);
                    }}
                  >
                    <X className="h-2 w-2" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function ColorPicker({
  color,
  onChange,
  showAlpha = false,
  showPalette = true,
}: {
  color: RGBA;
  onChange: (color: RGBA) => void;
  showAlpha?: boolean;
  showPalette?: boolean;
}) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(color.r, color.g, color.b));
  const [hexInput, setHexInput] = useState(() => rgbaToHex(color));

  // Track if the color change came from internal vs external
  const isInternalChange = useRef(false);

  // Sync HSV when external color changes
  useEffect(() => {
    if (!isInternalChange.current) {
      setHsv(rgbToHsv(color.r, color.g, color.b));
      setHexInput(rgbaToHex(color));
    }
    isInternalChange.current = false;
  }, [color.r, color.g, color.b, color.a]);

  const updateFromHsv = useCallback(
    (newHsv: HSV, alpha = color.a) => {
      const rgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
      const newColor = { ...rgb, a: alpha };
      setHsv(newHsv);
      setHexInput(rgbaToHex(newColor));
      isInternalChange.current = true;
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
      isInternalChange.current = true;
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
      isInternalChange.current = true;
      onChange(newColor);
    }
  };

  const handlePaletteSelect = useCallback(
    (paletteColor: RGBA) => {
      setHsv(rgbToHsv(paletteColor.r, paletteColor.g, paletteColor.b));
      setHexInput(rgbaToHex(paletteColor));
      isInternalChange.current = true;
      onChange({ ...paletteColor });
    },
    [onChange]
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
      />

      {/* Hue slider */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Hue</Label>
        <HueSlider hue={hsv.h} onChange={handleHueChange} />
      </div>

      {/* Alpha slider */}
      {showAlpha && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Alpha ({Math.round((color.a / 255) * 100)}%)
          </Label>
          <AlphaSlider alpha={color.a} color={currentRgb} onChange={handleAlphaChange} />
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
