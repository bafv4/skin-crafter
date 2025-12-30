import { type Layer, type LayerGroup, type RGBA, SKIN_WIDTH, SKIN_HEIGHT } from '../types/editor';

// Create empty composite (64x64 transparent) - optimized with preallocated arrays
export function createEmptyComposite(): RGBA[][] {
  const result: RGBA[][] = new Array(SKIN_HEIGHT);
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    const row: RGBA[] = new Array(SKIN_WIDTH);
    for (let x = 0; x < SKIN_WIDTH; x++) {
      row[x] = { r: 0, g: 0, b: 0, a: 0 };
    }
    result[y] = row;
  }
  return result;
}

// Alpha blend foreground onto background (standard Porter-Duff "over" operation)
// Mutates the target object for performance
export function alphaBlendMut(target: RGBA, foreground: RGBA): void {
  const fgAlpha = foreground.a / 255;
  const bgAlpha = target.a / 255;
  const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);

  if (outAlpha === 0) {
    target.r = 0;
    target.g = 0;
    target.b = 0;
    target.a = 0;
    return;
  }

  const invOutAlpha = 1 / outAlpha;
  const bgContrib = bgAlpha * (1 - fgAlpha);
  target.r = Math.round((foreground.r * fgAlpha + target.r * bgContrib) * invOutAlpha);
  target.g = Math.round((foreground.g * fgAlpha + target.g * bgContrib) * invOutAlpha);
  target.b = Math.round((foreground.b * fgAlpha + target.b * bgContrib) * invOutAlpha);
  target.a = Math.round(outAlpha * 255);
}

// Non-mutating version for backwards compatibility
export function alphaBlend(background: RGBA, foreground: RGBA): RGBA {
  const result = { ...background };
  alphaBlendMut(result, foreground);
  return result;
}

// Get set of hidden layer IDs based on layer visibility and group visibility
function getHiddenLayerIds(layers: Layer[], layerGroups: LayerGroup[]): Set<string> {
  const hiddenLayerIds = new Set<string>();
  const hiddenGroupIds = new Set(
    layerGroups.filter((g) => !g.visible).map((g) => g.id)
  );

  for (const layer of layers) {
    if (!layer.visible || (layer.groupId && hiddenGroupIds.has(layer.groupId))) {
      hiddenLayerIds.add(layer.id);
    }
  }

  return hiddenLayerIds;
}

// Reusable temp pixel for opacity adjustment
const tempPixel: RGBA = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Compute the composite (flattened) image from all layers.
 *
 * Layers are sorted by:
 * 1. Group order (if in a group) - higher order = background
 * 2. Layer order within group (or globally if ungrouped) - higher order = background
 *
 * This means lower order values appear on top (foreground).
 */
export function computeLayerComposite(
  layers: Layer[],
  layerGroups: LayerGroup[]
): RGBA[][] {
  const result = createEmptyComposite();

  // Fast path: no layers
  if (layers.length === 0) return result;

  const hiddenLayerIds = getHiddenLayerIds(layers, layerGroups);

  // Build group order map for fast lookup
  const groupOrderMap = new Map<string, number>();
  for (const group of layerGroups) {
    groupOrderMap.set(group.id, group.order);
  }

  // Filter and sort layers - only visible ones
  const visibleLayers: Layer[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!hiddenLayerIds.has(layer.id)) {
      visibleLayers.push(layer);
    }
  }

  // Fast path: no visible layers
  if (visibleLayers.length === 0) return result;

  // Sort by group order first, then by layer order within group
  // Higher order = draw first = background
  visibleLayers.sort((a, b) => {
    // Get effective group order (use Infinity for ungrouped layers so they sort to back initially)
    const aGroupOrder = a.groupId ? (groupOrderMap.get(a.groupId) ?? Infinity) : Infinity;
    const bGroupOrder = b.groupId ? (groupOrderMap.get(b.groupId) ?? Infinity) : Infinity;

    // First compare by group order (higher = background)
    if (aGroupOrder !== bGroupOrder) {
      return bGroupOrder - aGroupOrder;
    }

    // Within the same group (or both ungrouped), compare by layer order
    return b.order - a.order;
  });

  // Composite from back to front
  for (let li = 0; li < visibleLayers.length; li++) {
    const layer = visibleLayers[li];
    const layerOpacity = (layer.opacity ?? 100) / 100;
    const layerPixels = layer.pixels;
    const hasOpacity = layerOpacity < 1;

    for (let y = 0; y < SKIN_HEIGHT; y++) {
      const layerRow = layerPixels[y];
      if (!layerRow) continue;
      const resultRow = result[y];

      for (let x = 0; x < SKIN_WIDTH; x++) {
        const pixel = layerRow[x];
        if (!pixel || pixel.a === 0) continue;

        // Apply layer opacity to pixel alpha if needed
        if (hasOpacity) {
          tempPixel.r = pixel.r;
          tempPixel.g = pixel.g;
          tempPixel.b = pixel.b;
          tempPixel.a = Math.round(pixel.a * layerOpacity);
          alphaBlendMut(resultRow[x], tempPixel);
        } else {
          alphaBlendMut(resultRow[x], pixel);
        }
      }
    }
  }

  return result;
}

/**
 * Check if two RGBA colors are equal
 */
export function rgbaEqual(a: RGBA | null, b: RGBA | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
