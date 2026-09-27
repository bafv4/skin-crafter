import {
  type RGBA,
  type Layer,
  type LayerGroup,
  type LayerPixels,
  type SkinRegion,
  SKIN_WIDTH,
  SKIN_HEIGHT,
  SKIN_PARTS,
  generateId,
  createEmptyLayerPixels,
  cloneLayerPixels,
} from '../types/editor';
import { alphaBlendMut, compareLayersBackToFront } from './layerComposite';

// Color similarity threshold presets (0-441, where 441 is max distance in RGB space)
export const COLOR_THRESHOLD_PRESETS = {
  strict: 15,    // Very similar colors only
  normal: 30,    // Default - balanced
  loose: 50,     // More variation allowed
  veryLoose: 80, // Large color differences allowed
} as const;

export type ColorThresholdPreset = keyof typeof COLOR_THRESHOLD_PRESETS;

// Default threshold
const COLOR_SIMILARITY_THRESHOLD = COLOR_THRESHOLD_PRESETS.normal;

// Calculate color distance (Euclidean distance in RGB space)
function colorDistance(c1: RGBA, c2: RGBA): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Check if two colors are similar
function areColorsSimilar(c1: RGBA, c2: RGBA, threshold: number = COLOR_SIMILARITY_THRESHOLD): boolean {
  return colorDistance(c1, c2) <= threshold;
}

// Get the skin part that contains a pixel
function getSkinPart(x: number, y: number): SkinRegion | null {
  for (const part of SKIN_PARTS) {
    if (
      x >= part.x &&
      x < part.x + part.width &&
      y >= part.y &&
      y < part.y + part.height
    ) {
      return part;
    }
  }
  return null;
}

// Get the body part name from a skin region (e.g., "head-front" -> "head")
// includeLayer: if true, includes layer info to prevent cross-layer grouping
function getBodyPartName(region: SkinRegion, includeLayer = false): string {
  const parts = region.name.split('-');
  let baseName: string;

  // Handle layer 2 parts
  if (region.layer === 2) {
    // Map layer 2 names to their base body parts
    const layer2Map: Record<string, string> = {
      'hat': 'head',
      'jacket': 'body',
      'right-sleeve': 'right-arm',
      'left-sleeve': 'left-arm',
      'right-pants': 'right-leg',
      'left-pants': 'left-leg',
    };
    const prefix = parts.slice(0, -1).join('-');
    baseName = layer2Map[prefix] || prefix;
  } else {
    // For layer 1, just remove the face direction (front, back, etc.)
    baseName = parts.slice(0, -1).join('-');
  }

  // Include layer info to prevent cross-layer grouping
  if (includeLayer) {
    return `${baseName}-L${region.layer}`;
  }
  return baseName;
}

// ---- 3D で隣り合うピクセル（UV 上では離れた、別の面の辺同士） ----
//
// 3D プレビュー（Preview3D.client.tsx の createSkinGeometry）と同じ規則で、各面の四隅が
// 箱のどこに来るかを定め、ピクセル中心の 3D 座標から隣り合う組を求める。
// three.js BoxGeometry の面に skinview3d と同じ UV の貼り方をしたときの対応:
//   front → +Z、back → -Z、right（キャラクターの右）→ -X、left → +X、top → +Y、bottom → -Y
// 各面の画像上の 左上・右上・左下・右下 が、3D のどの角に来るか（w, h, d は箱の半分の大きさ）
type Vec3 = [number, number, number];
type FaceCorners = { tl: Vec3; tr: Vec3; bl: Vec3; br: Vec3 };

const FACE_CORNERS: Record<string, (w: number, h: number, d: number) => FaceCorners> = {
  front: (w, h, d) => ({ tl: [-w, h, d], tr: [w, h, d], bl: [-w, -h, d], br: [w, -h, d] }),
  back: (w, h, d) => ({ tl: [w, h, -d], tr: [-w, h, -d], bl: [w, -h, -d], br: [-w, -h, -d] }),
  right: (w, h, d) => ({ tl: [-w, h, -d], tr: [-w, h, d], bl: [-w, -h, -d], br: [-w, -h, d] }),
  left: (w, h, d) => ({ tl: [w, h, d], tr: [w, h, -d], bl: [w, -h, d], br: [w, -h, -d] }),
  top: (w, h, d) => ({ tl: [-w, h, -d], tr: [w, h, -d], bl: [-w, h, d], br: [w, h, d] }),
  // 底面は three.js の -Y 面の頂点順に合わせて UV の貼り方が異なる（上下が反転する）
  bottom: (w, h, d) => ({ tl: [-w, -h, -d], tr: [w, -h, -d], bl: [-w, -h, d], br: [w, -h, d] }),
};

type PixelPair = { p1: { x: number; y: number }; p2: { x: number; y: number } };

let adjacentPairsCache: PixelPair[] | null = null;

/**
 * 3D で辺を挟んで隣り合う、別の面のピクセルの組を返す（同じパーツ内のみ）。
 * ピクセル中心同士の距離が √0.5（辺をまたいだ隣）の組を隣接とみなす。
 */
export function get3DAdjacentPixelPairs(): PixelPair[] {
  if (adjacentPairsCache) return adjacentPairsCache;

  // パーツ（head, hat, right-arm など）ごとに面の領域をまとめる
  const parts = new Map<string, Map<string, SkinRegion>>();
  for (const region of SKIN_PARTS) {
    const i = region.name.lastIndexOf('-');
    const part = region.name.slice(0, i);
    if (!parts.has(part)) parts.set(part, new Map());
    parts.get(part)!.set(region.name.slice(i + 1), region);
  }

  const pairs: PixelPair[] = [];
  for (const faces of parts.values()) {
    const front = faces.get('front');
    const right = faces.get('right');
    if (!front || !right) continue;
    // 箱の大きさ（ピクセル単位）の半分
    const w = front.width / 2;
    const h = front.height / 2;
    const d = right.width / 2;

    // 各面の辺にあるピクセルの 3D 中心座標
    const edgePixels: { face: string; x: number; y: number; pos: Vec3 }[] = [];
    for (const [face, region] of faces) {
      const cornersOf = FACE_CORNERS[face];
      if (!cornersOf) continue;
      const { tl, tr, bl, br } = cornersOf(w, h, d);
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
          const onEdge =
            x === region.x || x === region.x + region.width - 1 ||
            y === region.y || y === region.y + region.height - 1;
          if (!onEdge) continue;
          const s = (x - region.x + 0.5) / region.width;
          const t = (y - region.y + 0.5) / region.height;
          const pos = [0, 1, 2].map(
            (k) => tl[k] * (1 - s) * (1 - t) + tr[k] * s * (1 - t) + bl[k] * (1 - s) * t + br[k] * s * t
          ) as Vec3;
          edgePixels.push({ face, x, y, pos });
        }
      }
    }

    for (let i = 0; i < edgePixels.length; i++) {
      for (let j = i + 1; j < edgePixels.length; j++) {
        const a = edgePixels[i];
        const b = edgePixels[j];
        if (a.face === b.face) continue;
        const dx = a.pos[0] - b.pos[0];
        const dy = a.pos[1] - b.pos[1];
        const dz = a.pos[2] - b.pos[2];
        if (Math.abs(dx * dx + dy * dy + dz * dz - 0.5) < 1e-6) {
          pairs.push({ p1: { x: a.x, y: a.y }, p2: { x: b.x, y: b.y } });
        }
      }
    }
  }

  adjacentPairsCache = pairs;
  return pairs;
}

// Union-Find data structure for connected components
class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]); // Path compression
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX !== rootY) {
      // Union by rank
      if (this.rank[rootX] < this.rank[rootY]) {
        this.parent[rootX] = rootY;
      } else if (this.rank[rootX] > this.rank[rootY]) {
        this.parent[rootY] = rootX;
      } else {
        this.parent[rootY] = rootX;
        this.rank[rootX]++;
      }
    }
  }

  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }
}

// Calculate noise settings based on color threshold
// Higher threshold = more color variation absorbed = more noise needed to recreate it
function calculateNoiseFromThreshold(threshold: number): { brightness: number; hue: number } {
  // Map threshold to noise (0-100 scale)
  // threshold 15 -> noise ~5, threshold 80 -> noise ~40
  const noiseFactor = Math.round((threshold / 80) * 40);
  return {
    brightness: Math.min(noiseFactor, 50),
    hue: Math.min(Math.round(noiseFactor * 0.5), 25), // Hue noise is less aggressive
  };
}

/**
 * Generate layers from image data.
 * Each layer will have its own pixel data.
 */
export function generateLayersFromImageData(
  imageData: ImageData,
  colorThreshold: number = COLOR_SIMILARITY_THRESHOLD,
  applyNoiseFromThreshold = true
): { layers: Layer[] } {
  const width = Math.min(imageData.width, SKIN_WIDTH);
  const height = Math.min(imageData.height, SKIN_HEIGHT);

  // Create temporary color array
  const colors: (RGBA | null)[][] = [];
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    colors[y] = [];
    for (let x = 0; x < SKIN_WIDTH; x++) {
      if (x < width && y < height) {
        const i = (y * imageData.width + x) * 4;
        const a = imageData.data[i + 3];
        if (a > 0) {
          colors[y][x] = {
            r: imageData.data[i],
            g: imageData.data[i + 1],
            b: imageData.data[i + 2],
            a,
          };
        } else {
          colors[y][x] = null;
        }
      } else {
        colors[y][x] = null;
      }
    }
  }

  // Union-Find for connected components
  const uf = new UnionFind(SKIN_WIDTH * SKIN_HEIGHT);
  const toIndex = (x: number, y: number) => y * SKIN_WIDTH + x;

  // Connect adjacent similar pixels within the same body part AND same layer
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const color = colors[y][x];
      if (!color) continue;

      const currentPart = getSkinPart(x, y);
      // Use includeLayer=true to prevent cross-layer grouping
      const currentBodyPart = currentPart ? getBodyPartName(currentPart, true) : null;

      // Check right neighbor
      if (x + 1 < SKIN_WIDTH) {
        const rightColor = colors[y][x + 1];
        if (rightColor) {
          const rightPart = getSkinPart(x + 1, y);
          const rightBodyPart = rightPart ? getBodyPartName(rightPart, true) : null;

          // Only connect if same body part (including layer) and similar color
          if (
            currentBodyPart === rightBodyPart &&
            areColorsSimilar(color, rightColor, colorThreshold)
          ) {
            uf.union(toIndex(x, y), toIndex(x + 1, y));
          }
        }
      }

      // Check bottom neighbor
      if (y + 1 < SKIN_HEIGHT) {
        const bottomColor = colors[y + 1][x];
        if (bottomColor) {
          const bottomPart = getSkinPart(x, y + 1);
          const bottomBodyPart = bottomPart ? getBodyPartName(bottomPart, true) : null;

          // Only connect if same body part (including layer) and similar color
          if (
            currentBodyPart === bottomBodyPart &&
            areColorsSimilar(color, bottomColor, colorThreshold)
          ) {
            uf.union(toIndex(x, y), toIndex(x, y + 1));
          }
        }
      }

      // Check bottom-right neighbor (diagonal)
      if (x + 1 < SKIN_WIDTH && y + 1 < SKIN_HEIGHT) {
        const bottomRightColor = colors[y + 1][x + 1];
        if (bottomRightColor) {
          const bottomRightPart = getSkinPart(x + 1, y + 1);
          const bottomRightBodyPart = bottomRightPart ? getBodyPartName(bottomRightPart, true) : null;

          if (
            currentBodyPart === bottomRightBodyPart &&
            areColorsSimilar(color, bottomRightColor, colorThreshold)
          ) {
            uf.union(toIndex(x, y), toIndex(x + 1, y + 1));
          }
        }
      }

      // Check bottom-left neighbor (diagonal)
      if (x - 1 >= 0 && y + 1 < SKIN_HEIGHT) {
        const bottomLeftColor = colors[y + 1][x - 1];
        if (bottomLeftColor) {
          const bottomLeftPart = getSkinPart(x - 1, y + 1);
          const bottomLeftBodyPart = bottomLeftPart ? getBodyPartName(bottomLeftPart, true) : null;

          if (
            currentBodyPart === bottomLeftBodyPart &&
            areColorsSimilar(color, bottomLeftColor, colorThreshold)
          ) {
            uf.union(toIndex(x, y), toIndex(x - 1, y + 1));
          }
        }
      }
    }
  }

  // Connect 3D-adjacent pixels (edges that connect in 3D but not in 2D UV space)
  // This ensures pixels on adjacent faces of the same body part are grouped together
  const adjacentPairs = get3DAdjacentPixelPairs();
  for (const { p1, p2 } of adjacentPairs) {
    const color1 = colors[p1.y]?.[p1.x];
    const color2 = colors[p2.y]?.[p2.x];

    if (color1 && color2 && areColorsSimilar(color1, color2, colorThreshold)) {
      // Both pixels are within the same body part (get3DAdjacentPixelPairs only pairs faces of one part)
      uf.union(toIndex(p1.x, p1.y), toIndex(p2.x, p2.y));
    }
  }

  // Collect components and calculate average colors
  const componentPixels = new Map<number, { x: number; y: number; color: RGBA }[]>();

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const color = colors[y][x];
      if (!color) continue;

      const root = uf.find(toIndex(x, y));
      if (!componentPixels.has(root)) {
        componentPixels.set(root, []);
      }
      componentPixels.get(root)!.push({ x, y, color });
    }
  }

  // Calculate noise settings based on threshold
  const noiseSettings = applyNoiseFromThreshold
    ? calculateNoiseFromThreshold(colorThreshold)
    : { brightness: 0, hue: 0 };

  // Create layers from components
  const layers: Layer[] = [];

  let layerIndex = 1;
  for (const [, pixels] of componentPixels) {
    // Calculate average color for the layer
    let totalR = 0, totalG = 0, totalB = 0;
    for (const p of pixels) {
      totalR += p.color.r;
      totalG += p.color.g;
      totalB += p.color.b;
    }
    const avgColor: RGBA = {
      r: Math.round(totalR / pixels.length),
      g: Math.round(totalG / pixels.length),
      b: Math.round(totalB / pixels.length),
      a: 255,
    };

    // Get part name for layer naming (include skin layer info for Layer 2)
    const firstPixel = pixels[0];
    const part = getSkinPart(firstPixel.x, firstPixel.y);
    const partName = part ? getBodyPartName(part) : 'unknown';
    const overlaySuffix = part && part.layer === 2 ? '-overlay' : '';

    // Create layer with its own pixel data
    const layerPixels = createEmptyLayerPixels();
    for (const p of pixels) {
      layerPixels[p.y][p.x] = { ...p.color };
    }

    const layer: Layer = {
      id: generateId(),
      name: `${partName}${overlaySuffix}-${layerIndex}`,
      baseColor: avgColor,
      noiseSettings: { ...noiseSettings },
      groupId: null,
      order: layerIndex - 1,
      layerType: 'singleColor',
      visible: true,
      opacity: 100,
      pixels: layerPixels,
    };
    layers.push(layer);

    layerIndex++;
  }

  return { layers };
}

// ---- レイヤーの統合（重なり順どおりに合成） ----

// 不透明度を掛けた実効ピクセル（合成と同じく、アルファは整数に丸める）。見えないなら null
function effectivePixel(pixel: RGBA | null, opacity: number): RGBA | null {
  if (!pixel || pixel.a === 0) return null;
  const a = opacity < 1 ? Math.round(pixel.a * opacity) : pixel.a;
  return a === 0 ? null : { r: pixel.r, g: pixel.g, b: pixel.b, a };
}

/**
 * 2 枚のレイヤーのピクセルを、画面の合成と同じ規則（手前を上に Porter-Duff over）で 1 枚にする。
 * 各レイヤーの不透明度はピクセルのアルファに焼き込む（結果のレイヤーは不透明度 100% で使う）
 */
function composeLayerPixels(back: Layer, front: Layer): LayerPixels {
  const result = createEmptyLayerPixels();
  const backOpacity = (back.opacity ?? 100) / 100;
  const frontOpacity = (front.opacity ?? 100) / 100;
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const b = effectivePixel(back.pixels[y][x], backOpacity);
      const f = effectivePixel(front.pixels[y][x], frontOpacity);
      if (!b || !f) {
        result[y][x] = b ?? f;
      } else {
        alphaBlendMut(b, f);
        result[y][x] = b.a > 0 ? b : null;
      }
    }
  }
  return result;
}

/**
 * source を target に統合したレイヤーを返す（target の ID・名前・重なり位置などを引き継ぐ）。
 * 重なるピクセルは画面の合成と同じく、手前のレイヤーが上になる
 */
function mergeLayerInto(
  target: Layer,
  source: Layer,
  targetIndex: number,
  sourceIndex: number,
  groupOrderMap: Map<string, number>
): Layer {
  // 描画順が同じなら、合成と同じく配列の後ろの方が手前
  const cmp = compareLayersBackToFront(target, source, groupOrderMap) || targetIndex - sourceIndex;
  const [back, front] = cmp < 0 ? [target, source] : [source, target];
  return { ...target, opacity: 100, pixels: composeLayerPixels(back, front) };
}

/**
 * Merge similar layers (optional post-processing).
 * Returns new layers with merged pixel data.
 */
export function mergeSimilarLayers(
  layers: Layer[],
  threshold: number = COLOR_SIMILARITY_THRESHOLD,
  applyNoiseFromThreshold = true,
  layerGroups: LayerGroup[] = []
): { layers: Layer[] } {
  if (layers.length <= 1) return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };

  const noiseSettings = applyNoiseFromThreshold
    ? calculateNoiseFromThreshold(threshold)
    : null;

  const groupOrderMap = new Map(layerGroups.map((g) => [g.id, g.order]));
  // 元の配列での位置（描画順が同じ場合の前後判定に使う）
  const indexOf = new Map(layers.map((l, i) => [l.id, i]));
  const newLayers: Layer[] = [];

  for (const layer of layers) {
    // Find if there's an existing layer with similar color
    const mergedIndex = newLayers.findIndex((existing) =>
      areColorsSimilar(layer.baseColor, existing.baseColor, threshold)
    );

    if (mergedIndex >= 0) {
      // 既存のレイヤーに重なり順どおりに統合する
      const existing = newLayers[mergedIndex];
      newLayers[mergedIndex] = mergeLayerInto(
        existing,
        layer,
        indexOf.get(existing.id)!,
        indexOf.get(layer.id)!,
        groupOrderMap
      );
    } else {
      // Create a new layer with cloned pixels
      const newLayer: Layer = {
        ...layer,
        pixels: cloneLayerPixels(layer.pixels),
      };
      // Apply noise settings if merging with threshold
      if (noiseSettings) {
        newLayer.noiseSettings = {
          brightness: Math.max(newLayer.noiseSettings.brightness, noiseSettings.brightness),
          hue: Math.max(newLayer.noiseSettings.hue, noiseSettings.hue),
        };
      }
      newLayers.push(newLayer);
    }
  }

  return { layers: newLayers };
}

/**
 * Merge two specific layers into one.
 * Source layer pixels are merged into target layer.
 */
export function mergeLayers(
  layers: Layer[],
  sourceLayerId: string,
  targetLayerId: string,
  layerGroups: LayerGroup[] = []
): { layers: Layer[] } {
  if (sourceLayerId === targetLayerId) {
    return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };
  }

  const sourceLayer = layers.find(l => l.id === sourceLayerId);
  const targetLayer = layers.find(l => l.id === targetLayerId);

  if (!sourceLayer || !targetLayer) {
    return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };
  }

  // Create new layers array, excluding source layer
  const newLayers: Layer[] = [];

  for (const layer of layers) {
    if (layer.id === sourceLayerId) {
      // Skip source layer - it will be merged into target
      continue;
    }

    if (layer.id === targetLayerId) {
      // 重なるピクセルは画面の合成と同じく手前のレイヤーが上になるように統合する
      const groupOrderMap = new Map(layerGroups.map((g) => [g.id, g.order]));
      newLayers.push(
        mergeLayerInto(layer, sourceLayer, layers.indexOf(targetLayer), layers.indexOf(sourceLayer), groupOrderMap)
      );
    } else {
      // Clone other layers as-is
      newLayers.push({ ...layer, pixels: cloneLayerPixels(layer.pixels) });
    }
  }

  return { layers: newLayers };
}

/**
 * Split a layer by re-analyzing color similarity within the layer.
 * Returns multiple new layers based on color clusters.
 */
export function splitLayerByColor(
  layers: Layer[],
  layerId: string,
  colorThreshold: number = COLOR_SIMILARITY_THRESHOLD,
  applyNoiseFromThreshold = true
): { layers: Layer[] } {
  const layer = layers.find(l => l.id === layerId);
  if (!layer) {
    return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };
  }

  // Collect all non-null pixels from this layer
  const layerPixels: { x: number; y: number; color: RGBA }[] = [];
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const pixel = layer.pixels[y][x];
      if (pixel && pixel.a > 0) {
        layerPixels.push({ x, y, color: pixel });
      }
    }
  }

  if (layerPixels.length === 0) {
    return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };
  }

  // Use Union-Find to create sub-layers based on color similarity and adjacency
  const uf = new UnionFind(layerPixels.length);
  const pixelIndexMap = new Map<string, number>();

  layerPixels.forEach((p, i) => {
    pixelIndexMap.set(`${p.x},${p.y}`, i);
  });

  // Connect adjacent pixels with similar colors (2D adjacency including diagonals)
  for (let i = 0; i < layerPixels.length; i++) {
    const p1 = layerPixels[i];
    const neighbors = [
      { x: p1.x + 1, y: p1.y },     // right
      { x: p1.x, y: p1.y + 1 },     // bottom
      { x: p1.x + 1, y: p1.y + 1 }, // bottom-right (diagonal)
      { x: p1.x - 1, y: p1.y + 1 }, // bottom-left (diagonal)
    ];

    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      const j = pixelIndexMap.get(key);
      if (j !== undefined) {
        const p2 = layerPixels[j];
        if (areColorsSimilar(p1.color, p2.color, colorThreshold)) {
          uf.union(i, j);
        }
      }
    }
  }

  // Also check 3D adjacent pairs
  const adjacentPairs = get3DAdjacentPixelPairs();
  for (const { p1, p2 } of adjacentPairs) {
    const i = pixelIndexMap.get(`${p1.x},${p1.y}`);
    const j = pixelIndexMap.get(`${p2.x},${p2.y}`);
    if (i !== undefined && j !== undefined) {
      const color1 = layerPixels[i].color;
      const color2 = layerPixels[j].color;
      if (areColorsSimilar(color1, color2, colorThreshold)) {
        uf.union(i, j);
      }
    }
  }

  // Collect sub-components
  const components = new Map<number, { x: number; y: number; color: RGBA }[]>();
  for (let i = 0; i < layerPixels.length; i++) {
    const root = uf.find(i);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root)!.push(layerPixels[i]);
  }

  // If only one component, no split needed
  if (components.size <= 1) {
    return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };
  }

  // Calculate noise settings
  const noiseSettings = applyNoiseFromThreshold
    ? calculateNoiseFromThreshold(colorThreshold)
    : { brightness: 0, hue: 0 };

  // 分割後のレイヤーは元のレイヤーと同じ重なり位置に並べる（見た目を変えないため）。
  // 同じグループで元のレイヤーより奥のレイヤーを、増える枚数分だけ後ろへずらす
  const shift = components.size - 1;
  const newLayers: Layer[] = layers
    .filter(l => l.id !== layerId)
    .map(l => ({
      ...l,
      order: l.groupId === layer.groupId && l.order > layer.order ? l.order + shift : l.order,
      pixels: cloneLayerPixels(l.pixels),
    }));

  let subIndex = 1;
  for (const [, componentPixels] of components) {
    // Calculate average color
    let totalR = 0, totalG = 0, totalB = 0;
    for (const p of componentPixels) {
      totalR += p.color.r;
      totalG += p.color.g;
      totalB += p.color.b;
    }
    const avgColor: RGBA = {
      r: Math.round(totalR / componentPixels.length),
      g: Math.round(totalG / componentPixels.length),
      b: Math.round(totalB / componentPixels.length),
      a: 255,
    };

    // Create pixel data for this component
    const componentPixelData = createEmptyLayerPixels();
    for (const p of componentPixels) {
      componentPixelData[p.y][p.x] = { ...p.color };
    }

    const newLayer: Layer = {
      id: generateId(),
      name: `${layer.name}-${subIndex}`,
      baseColor: avgColor,
      noiseSettings: { ...noiseSettings },
      groupId: layer.groupId,
      order: layer.order + subIndex - 1,
      layerType: layer.layerType,
      visible: layer.visible,
      opacity: layer.opacity ?? 100,
      pixels: componentPixelData,
    };
    newLayers.push(newLayer);

    subIndex++;
  }

  return { layers: newLayers };
}

/**
 * Split selected pixels from a layer into a new layer.
 */
export function splitLayerBySelection(
  layers: Layer[],
  layerId: string,
  selectedPixels: { x: number; y: number }[]
): { layers: Layer[]; newLayerId: string | null } {
  const layer = layers.find(l => l.id === layerId);
  if (!layer || selectedPixels.length === 0) {
    return {
      layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })),
      newLayerId: null,
    };
  }

  // Filter to only include pixels that actually have data in this layer
  const validPixels = selectedPixels.filter(p =>
    p.x >= 0 && p.x < SKIN_WIDTH &&
    p.y >= 0 && p.y < SKIN_HEIGHT &&
    layer.pixels[p.y][p.x] !== null &&
    layer.pixels[p.y][p.x]!.a > 0
  );

  if (validPixels.length === 0) {
    return {
      layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })),
      newLayerId: null,
    };
  }

  // Calculate average color of selected pixels
  let totalR = 0, totalG = 0, totalB = 0;
  for (const p of validPixels) {
    const pixel = layer.pixels[p.y][p.x]!;
    totalR += pixel.r;
    totalG += pixel.g;
    totalB += pixel.b;
  }
  const avgColor: RGBA = {
    r: Math.round(totalR / validPixels.length),
    g: Math.round(totalG / validPixels.length),
    b: Math.round(totalB / validPixels.length),
    a: 255,
  };

  // Create new layer with the selected pixels
  const newLayerPixels = createEmptyLayerPixels();
  for (const p of validPixels) {
    newLayerPixels[p.y][p.x] = { ...layer.pixels[p.y][p.x]! };
  }

  // 新しいレイヤーは元のレイヤーのすぐ手前（同じ重なり位置）に置き、見た目を変えない。
  // 同じグループで元のレイヤー以降（元のレイヤーを含む）を 1 つ後ろへずらす
  const newLayerId = generateId();
  const newLayer: Layer = {
    id: newLayerId,
    name: `${layer.name}-split`,
    baseColor: avgColor,
    noiseSettings: { ...layer.noiseSettings },
    groupId: layer.groupId,
    order: layer.order,
    layerType: layer.layerType,
    visible: layer.visible,
    opacity: layer.opacity ?? 100,
    pixels: newLayerPixels,
  };

  // Create new layers array, removing selected pixels from source layer
  const newLayers: Layer[] = [];
  for (const l of layers) {
    const order = l.groupId === layer.groupId && l.order >= layer.order ? l.order + 1 : l.order;
    if (l.id === layerId) {
      // Clone source layer and remove selected pixels
      const clonedPixels = cloneLayerPixels(l.pixels);
      for (const p of validPixels) {
        clonedPixels[p.y][p.x] = null;
      }
      newLayers.push({ ...l, order, pixels: clonedPixels });
    } else {
      newLayers.push({ ...l, order, pixels: cloneLayerPixels(l.pixels) });
    }
  }
  newLayers.push(newLayer);

  return { layers: newLayers, newLayerId };
}

/**
 * Blend border pixels with adjacent different-layer pixels.
 * This creates a smooth transition at layer boundaries.
 * If targetLayerId is provided, only blend pixels in that layer.
 */
export function blendBorderPixels(
  layers: Layer[],
  blendStrength: number = 15, // percentage of blend (0-100)
  targetLayerId?: string // optional: only blend this specific layer
): { layers: Layer[] } {
  // Build a composite map to know which layer each pixel belongs to
  // (for finding adjacent pixels from different layers)
  const pixelLayerMap: (string | null)[][] = [];
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    pixelLayerMap[y] = [];
    for (let x = 0; x < SKIN_WIDTH; x++) {
      pixelLayerMap[y][x] = null;
    }
  }

  // Sort layers by order (lower order = front, drawn last = takes priority)
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);

  // Build pixel ownership map (who owns each pixel based on order priority)
  for (const layer of sortedLayers.slice().reverse()) {
    // Iterate in reverse order (higher order first = background)
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const pixel = layer.pixels[y][x];
        if (pixel && pixel.a > 0) {
          pixelLayerMap[y][x] = layer.id;
        }
      }
    }
  }

  // Now blend
  const newLayers: Layer[] = layers.map(layer => {
    // If targetLayerId is specified, only process that layer
    if (targetLayerId && layer.id !== targetLayerId) {
      return { ...layer, pixels: cloneLayerPixels(layer.pixels) };
    }

    const newPixels = cloneLayerPixels(layer.pixels);

    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const pixel = layer.pixels[y][x];
        if (!pixel || pixel.a === 0) continue;

        // Get current pixel's skin part
        const currentPart = getSkinPart(x, y);
        if (!currentPart) continue;

        // Collect colors of adjacent pixels from different layers
        const adjacentColors: RGBA[] = [];
        const neighbors = [
          { dx: -1, dy: 0 },
          { dx: 1, dy: 0 },
          { dx: 0, dy: -1 },
          { dx: 0, dy: 1 },
        ];

        for (const { dx, dy } of neighbors) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || nx >= SKIN_WIDTH || ny < 0 || ny >= SKIN_HEIGHT) continue;

          const neighborLayerId = pixelLayerMap[ny][nx];
          if (!neighborLayerId || neighborLayerId === layer.id) continue;

          // Check if neighbor is in same body part (to respect UV boundaries)
          const neighborPart = getSkinPart(nx, ny);
          if (!neighborPart) continue;

          // Only blend within same body part (not across UV boundaries)
          const currentBodyPart = getBodyPartName(currentPart, true);
          const neighborBodyPart = getBodyPartName(neighborPart, true);
          if (currentBodyPart !== neighborBodyPart) continue;

          // Get the neighbor's color from its layer
          const neighborLayer = layers.find(l => l.id === neighborLayerId);
          if (!neighborLayer) continue;
          const neighborPixel = neighborLayer.pixels[ny][nx];
          if (!neighborPixel || neighborPixel.a === 0) continue;

          adjacentColors.push(neighborPixel);
        }

        // If this pixel is on a boundary, blend it
        if (adjacentColors.length > 0) {
          // Calculate average of adjacent different-layer colors
          let totalR = 0, totalG = 0, totalB = 0;
          for (const c of adjacentColors) {
            totalR += c.r;
            totalG += c.g;
            totalB += c.b;
          }
          const avgR = totalR / adjacentColors.length;
          const avgG = totalG / adjacentColors.length;
          const avgB = totalB / adjacentColors.length;

          // Blend current color towards adjacent average
          const factor = blendStrength / 100;
          newPixels[y][x] = {
            r: Math.round(pixel.r + (avgR - pixel.r) * factor),
            g: Math.round(pixel.g + (avgG - pixel.g) * factor),
            b: Math.round(pixel.b + (avgB - pixel.b) * factor),
            a: pixel.a,
          };
        }
      }
    }

    return { ...layer, pixels: newPixels };
  });

  return { layers: newLayers };
}

// Export color distance for UI use
export { colorDistance, areColorsSimilar };
