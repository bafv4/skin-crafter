// RGBA color type
export interface RGBA {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-255
}

// Pixel data with layer association
export interface PixelData {
  layerId: string | null; // null = transparent
  color: RGBA; // actual display color (after noise applied)
}

// Material type for noise generation
export type MaterialType = 'hair' | 'cloth' | 'skin' | 'metal' | 'plastic' | 'other';

// Noise settings for a layer
export interface NoiseSettings {
  brightness: number; // 0-100
  hue: number; // 0-100
  material?: MaterialType; // Material type for noise characteristics
}

// Layer pixel data type (null = transparent)
export type LayerPixels = (RGBA | null)[][];

// Color layer
// Note: Primary pixel data is managed by PixelEngine (Web Worker) for performance.
// The `pixels` property is kept for:
// - Undo/redo history (snapshot-based)
// - Serialization (import/export)
// - Backwards compatibility during migration
export interface Layer {
  id: string;
  name: string;
  baseColor: RGBA;
  noiseSettings: NoiseSettings;
  groupId: string | null; // null = ungrouped
  order: number; // for sorting - lower order = front (higher priority)
  layerType: LayerType; // 'direct' = draw with any color, 'singleColor' = use baseColor
  visible: boolean; // whether the layer is visible in canvas/preview
  opacity: number; // 0-100, layer opacity percentage
  pixels: LayerPixels; // 64x64 pixel data - synced with PixelEngine
}

// Layer with pixel data in Uint8ClampedArray format (for PixelEngine transfer)
export interface LayerWithPixelData extends Layer {
  pixelData: Uint8ClampedArray;
}

// Layer group (for organizing layers)
export interface LayerGroup {
  id: string;
  name: string;
  collapsed: boolean;
  order: number; // for sorting groups
  visible: boolean; // whether all layers in the group are visible
}

// Legacy alias for backwards compatibility
export type Group = Layer;

// Tool types
export type ToolType = 'pencil' | 'eraser' | 'rectangle' | 'eyedropper';

// Model type
export type ModelType = 'steve' | 'alex';

// Layer type - 'direct' allows multi-color drawing, 'singleColor' uses base color only
export type LayerType = 'direct' | 'singleColor';

// Theme type
export type ThemeType = 'light' | 'dark' | 'system';

// Color palette entry
export interface PaletteColor {
  id: string;
  color: RGBA;
  name?: string;
}

// Pixel change for diff-based history (per-layer)
export interface PixelChange {
  layerId: string; // which layer was modified
  x: number;
  y: number;
  oldPixel: RGBA | null;
  newPixel: RGBA | null;
}

// Layer change for diff-based history
export interface LayerChange {
  type: 'add' | 'remove' | 'update';
  layerId: string;
  oldLayer?: Layer;
  newLayer?: Layer;
}

// Layer group change for diff-based history
export interface LayerGroupChange {
  type: 'add' | 'remove' | 'update';
  groupId: string;
  oldGroup?: LayerGroup;
  newGroup?: LayerGroup;
}

// History entry for undo/redo (diff-based)
export interface HistoryEntry {
  pixelChanges: PixelChange[];
  layerChanges: LayerChange[];
  layerGroupChanges: LayerGroupChange[];
}

// Skin part regions for UV mapping
export interface SkinRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: 1 | 2;
}

// Constants
export const SKIN_WIDTH = 64;
export const SKIN_HEIGHT = 64;
// With diff-based history, each entry is much smaller (only changed pixels)
export const MAX_HISTORY = 50;

// Skin part definitions (standard 64x64 skin format)
export const SKIN_PARTS: SkinRegion[] = [
  // Layer 1 - Head
  { name: 'head-top', x: 8, y: 0, width: 8, height: 8, layer: 1 },
  { name: 'head-bottom', x: 16, y: 0, width: 8, height: 8, layer: 1 },
  { name: 'head-right', x: 0, y: 8, width: 8, height: 8, layer: 1 },
  { name: 'head-front', x: 8, y: 8, width: 8, height: 8, layer: 1 },
  { name: 'head-left', x: 16, y: 8, width: 8, height: 8, layer: 1 },
  { name: 'head-back', x: 24, y: 8, width: 8, height: 8, layer: 1 },

  // Layer 1 - Body
  { name: 'body-top', x: 20, y: 16, width: 8, height: 4, layer: 1 },
  { name: 'body-bottom', x: 28, y: 16, width: 8, height: 4, layer: 1 },
  { name: 'body-right', x: 16, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'body-front', x: 20, y: 20, width: 8, height: 12, layer: 1 },
  { name: 'body-left', x: 28, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'body-back', x: 32, y: 20, width: 8, height: 12, layer: 1 },

  // Layer 1 - Right Arm
  { name: 'right-arm-top', x: 44, y: 16, width: 4, height: 4, layer: 1 },
  { name: 'right-arm-bottom', x: 48, y: 16, width: 4, height: 4, layer: 1 },
  { name: 'right-arm-right', x: 40, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'right-arm-front', x: 44, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'right-arm-left', x: 48, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'right-arm-back', x: 52, y: 20, width: 4, height: 12, layer: 1 },

  // Layer 1 - Left Arm
  { name: 'left-arm-top', x: 36, y: 48, width: 4, height: 4, layer: 1 },
  { name: 'left-arm-bottom', x: 40, y: 48, width: 4, height: 4, layer: 1 },
  { name: 'left-arm-right', x: 32, y: 52, width: 4, height: 12, layer: 1 },
  { name: 'left-arm-front', x: 36, y: 52, width: 4, height: 12, layer: 1 },
  { name: 'left-arm-left', x: 40, y: 52, width: 4, height: 12, layer: 1 },
  { name: 'left-arm-back', x: 44, y: 52, width: 4, height: 12, layer: 1 },

  // Layer 1 - Right Leg
  { name: 'right-leg-top', x: 4, y: 16, width: 4, height: 4, layer: 1 },
  { name: 'right-leg-bottom', x: 8, y: 16, width: 4, height: 4, layer: 1 },
  { name: 'right-leg-right', x: 0, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'right-leg-front', x: 4, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'right-leg-left', x: 8, y: 20, width: 4, height: 12, layer: 1 },
  { name: 'right-leg-back', x: 12, y: 20, width: 4, height: 12, layer: 1 },

  // Layer 1 - Left Leg
  { name: 'left-leg-top', x: 20, y: 48, width: 4, height: 4, layer: 1 },
  { name: 'left-leg-bottom', x: 24, y: 48, width: 4, height: 4, layer: 1 },
  { name: 'left-leg-right', x: 16, y: 52, width: 4, height: 12, layer: 1 },
  { name: 'left-leg-front', x: 20, y: 52, width: 4, height: 12, layer: 1 },
  { name: 'left-leg-left', x: 24, y: 52, width: 4, height: 12, layer: 1 },
  { name: 'left-leg-back', x: 28, y: 52, width: 4, height: 12, layer: 1 },

  // Layer 2 - Hat (Head overlay)
  { name: 'hat-top', x: 40, y: 0, width: 8, height: 8, layer: 2 },
  { name: 'hat-bottom', x: 48, y: 0, width: 8, height: 8, layer: 2 },
  { name: 'hat-right', x: 32, y: 8, width: 8, height: 8, layer: 2 },
  { name: 'hat-front', x: 40, y: 8, width: 8, height: 8, layer: 2 },
  { name: 'hat-left', x: 48, y: 8, width: 8, height: 8, layer: 2 },
  { name: 'hat-back', x: 56, y: 8, width: 8, height: 8, layer: 2 },

  // Layer 2 - Jacket (Body overlay)
  { name: 'jacket-top', x: 20, y: 32, width: 8, height: 4, layer: 2 },
  { name: 'jacket-bottom', x: 28, y: 32, width: 8, height: 4, layer: 2 },
  { name: 'jacket-right', x: 16, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'jacket-front', x: 20, y: 36, width: 8, height: 12, layer: 2 },
  { name: 'jacket-left', x: 28, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'jacket-back', x: 32, y: 36, width: 8, height: 12, layer: 2 },

  // Layer 2 - Right Sleeve
  { name: 'right-sleeve-top', x: 44, y: 32, width: 4, height: 4, layer: 2 },
  { name: 'right-sleeve-bottom', x: 48, y: 32, width: 4, height: 4, layer: 2 },
  { name: 'right-sleeve-right', x: 40, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'right-sleeve-front', x: 44, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'right-sleeve-left', x: 48, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'right-sleeve-back', x: 52, y: 36, width: 4, height: 12, layer: 2 },

  // Layer 2 - Left Sleeve
  { name: 'left-sleeve-top', x: 52, y: 48, width: 4, height: 4, layer: 2 },
  { name: 'left-sleeve-bottom', x: 56, y: 48, width: 4, height: 4, layer: 2 },
  { name: 'left-sleeve-right', x: 48, y: 52, width: 4, height: 12, layer: 2 },
  { name: 'left-sleeve-front', x: 52, y: 52, width: 4, height: 12, layer: 2 },
  { name: 'left-sleeve-left', x: 56, y: 52, width: 4, height: 12, layer: 2 },
  { name: 'left-sleeve-back', x: 60, y: 52, width: 4, height: 12, layer: 2 },

  // Layer 2 - Right Pants
  { name: 'right-pants-top', x: 4, y: 32, width: 4, height: 4, layer: 2 },
  { name: 'right-pants-bottom', x: 8, y: 32, width: 4, height: 4, layer: 2 },
  { name: 'right-pants-right', x: 0, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'right-pants-front', x: 4, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'right-pants-left', x: 8, y: 36, width: 4, height: 12, layer: 2 },
  { name: 'right-pants-back', x: 12, y: 36, width: 4, height: 12, layer: 2 },

  // Layer 2 - Left Pants
  { name: 'left-pants-top', x: 4, y: 48, width: 4, height: 4, layer: 2 },
  { name: 'left-pants-bottom', x: 8, y: 48, width: 4, height: 4, layer: 2 },
  { name: 'left-pants-right', x: 0, y: 52, width: 4, height: 12, layer: 2 },
  { name: 'left-pants-front', x: 4, y: 52, width: 4, height: 12, layer: 2 },
  { name: 'left-pants-left', x: 8, y: 52, width: 4, height: 12, layer: 2 },
  { name: 'left-pants-back', x: 12, y: 52, width: 4, height: 12, layer: 2 },
];

// Get skin parts for a specific model type
export function getSkinParts(modelType: ModelType): SkinRegion[] {
  if (modelType === 'steve') {
    return SKIN_PARTS;
  }

  // Alex model: arms are 3px wide instead of 4px
  const armWidth = 3;
  return SKIN_PARTS.map((part) => {
    // Right Arm Layer 1
    if (part.name === 'right-arm-top') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'right-arm-bottom') {
      return { ...part, x: 44 + armWidth, width: armWidth };
    }
    if (part.name === 'right-arm-front') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'right-arm-left') {
      return { ...part, x: 44 + armWidth };
    }
    if (part.name === 'right-arm-back') {
      return { ...part, x: 44 + armWidth + 4, width: armWidth };
    }

    // Left Arm Layer 1
    if (part.name === 'left-arm-top') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'left-arm-bottom') {
      return { ...part, x: 36 + armWidth, width: armWidth };
    }
    if (part.name === 'left-arm-front') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'left-arm-left') {
      return { ...part, x: 36 + armWidth };
    }
    if (part.name === 'left-arm-back') {
      return { ...part, x: 36 + armWidth + 4, width: armWidth };
    }

    // Right Sleeve Layer 2
    if (part.name === 'right-sleeve-top') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'right-sleeve-bottom') {
      return { ...part, x: 44 + armWidth, width: armWidth };
    }
    if (part.name === 'right-sleeve-front') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'right-sleeve-left') {
      return { ...part, x: 44 + armWidth };
    }
    if (part.name === 'right-sleeve-back') {
      return { ...part, x: 44 + armWidth + 4, width: armWidth };
    }

    // Left Sleeve Layer 2
    if (part.name === 'left-sleeve-top') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'left-sleeve-bottom') {
      return { ...part, x: 52 + armWidth, width: armWidth };
    }
    if (part.name === 'left-sleeve-front') {
      return { ...part, width: armWidth };
    }
    if (part.name === 'left-sleeve-left') {
      return { ...part, x: 52 + armWidth };
    }
    if (part.name === 'left-sleeve-back') {
      return { ...part, x: 52 + armWidth + 4, width: armWidth };
    }

    return part;
  });
}

// Helper functions

// Create empty layer pixels (64x64 grid of null)
export function createEmptyLayerPixels(): LayerPixels {
  const pixels: LayerPixels = [];
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    pixels[y] = [];
    for (let x = 0; x < SKIN_WIDTH; x++) {
      pixels[y][x] = null;
    }
  }
  return pixels;
}

// Clone layer pixels (deep copy)
export function cloneLayerPixels(pixels: LayerPixels): LayerPixels {
  return pixels.map(row => row.map(p => p ? { ...p } : null));
}

// DEPRECATED: Use createEmptyLayerPixels instead
// Kept for backward compatibility during migration
export function createEmptyPixels(): PixelData[][] {
  const pixels: PixelData[][] = [];
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    pixels[y] = [];
    for (let x = 0; x < SKIN_WIDTH; x++) {
      pixels[y][x] = {
        layerId: null,
        color: { r: 0, g: 0, b: 0, a: 0 },
      };
    }
  }
  return pixels;
}

export function rgbaToHex(color: RGBA): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

export function hexToRgba(hex: string, alpha = 255): RGBA {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0, a: alpha };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
    a: alpha,
  };
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
