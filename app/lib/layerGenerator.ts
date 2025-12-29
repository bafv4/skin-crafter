import {
  type RGBA,
  type Layer,
  type LayerPixels,
  type SkinRegion,
  SKIN_WIDTH,
  SKIN_HEIGHT,
  SKIN_PARTS,
  generateId,
  createEmptyLayerPixels,
  cloneLayerPixels,
} from '../types/editor';

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

// Edge direction types
type EdgeDirection = 'top' | 'bottom' | 'left' | 'right';

// UV edge connection definition
// Defines how edges of different faces connect in 3D space
interface UVEdgeConnection {
  face1: string;       // e.g., "head-front"
  edge1: EdgeDirection;
  face2: string;       // e.g., "head-left"
  edge2: EdgeDirection;
  reversed: boolean;   // Whether the edge pixels are in reverse order
}

// Define all 3D edge connections for Minecraft skin parts
// When two edges connect, their pixels are adjacent in 3D even though separate in 2D
const UV_EDGE_CONNECTIONS: UVEdgeConnection[] = [
  // === HEAD (Layer 1) ===
  // Front-Left-Back-Right horizontal wrap (looking from outside)
  { face1: 'head-front', edge1: 'left', face2: 'head-right', edge2: 'right', reversed: false },
  { face1: 'head-front', edge1: 'right', face2: 'head-left', edge2: 'left', reversed: false },
  { face1: 'head-left', edge1: 'right', face2: 'head-back', edge2: 'left', reversed: false },
  { face1: 'head-right', edge1: 'left', face2: 'head-back', edge2: 'right', reversed: false },
  // Top connections (top face viewed from above, matching front orientation)
  { face1: 'head-front', edge1: 'top', face2: 'head-top', edge2: 'bottom', reversed: false },
  { face1: 'head-left', edge1: 'top', face2: 'head-top', edge2: 'right', reversed: true },
  { face1: 'head-right', edge1: 'top', face2: 'head-top', edge2: 'left', reversed: true },
  { face1: 'head-back', edge1: 'top', face2: 'head-top', edge2: 'top', reversed: true },
  // Bottom connections (bottom face viewed from below, front's bottom connects to bottom's bottom)
  { face1: 'head-front', edge1: 'bottom', face2: 'head-bottom', edge2: 'bottom', reversed: true },
  { face1: 'head-left', edge1: 'bottom', face2: 'head-bottom', edge2: 'right', reversed: true },
  { face1: 'head-right', edge1: 'bottom', face2: 'head-bottom', edge2: 'left', reversed: true },
  { face1: 'head-back', edge1: 'bottom', face2: 'head-bottom', edge2: 'top', reversed: false },

  // === BODY (Layer 1) ===
  { face1: 'body-front', edge1: 'left', face2: 'body-right', edge2: 'right', reversed: false },
  { face1: 'body-front', edge1: 'right', face2: 'body-left', edge2: 'left', reversed: false },
  { face1: 'body-left', edge1: 'right', face2: 'body-back', edge2: 'left', reversed: false },
  { face1: 'body-right', edge1: 'left', face2: 'body-back', edge2: 'right', reversed: false },
  { face1: 'body-front', edge1: 'top', face2: 'body-top', edge2: 'bottom', reversed: false },
  { face1: 'body-left', edge1: 'top', face2: 'body-top', edge2: 'right', reversed: true },
  { face1: 'body-right', edge1: 'top', face2: 'body-top', edge2: 'left', reversed: true },
  { face1: 'body-back', edge1: 'top', face2: 'body-top', edge2: 'top', reversed: true },
  { face1: 'body-front', edge1: 'bottom', face2: 'body-bottom', edge2: 'bottom', reversed: true },
  { face1: 'body-left', edge1: 'bottom', face2: 'body-bottom', edge2: 'right', reversed: true },
  { face1: 'body-right', edge1: 'bottom', face2: 'body-bottom', edge2: 'left', reversed: true },
  { face1: 'body-back', edge1: 'bottom', face2: 'body-bottom', edge2: 'top', reversed: false },

  // === RIGHT ARM (Layer 1) ===
  { face1: 'right-arm-front', edge1: 'left', face2: 'right-arm-right', edge2: 'right', reversed: false },
  { face1: 'right-arm-front', edge1: 'right', face2: 'right-arm-left', edge2: 'left', reversed: false },
  { face1: 'right-arm-left', edge1: 'right', face2: 'right-arm-back', edge2: 'left', reversed: false },
  { face1: 'right-arm-right', edge1: 'left', face2: 'right-arm-back', edge2: 'right', reversed: false },
  { face1: 'right-arm-front', edge1: 'top', face2: 'right-arm-top', edge2: 'bottom', reversed: false },
  { face1: 'right-arm-left', edge1: 'top', face2: 'right-arm-top', edge2: 'right', reversed: true },
  { face1: 'right-arm-right', edge1: 'top', face2: 'right-arm-top', edge2: 'left', reversed: true },
  { face1: 'right-arm-back', edge1: 'top', face2: 'right-arm-top', edge2: 'top', reversed: true },
  { face1: 'right-arm-front', edge1: 'bottom', face2: 'right-arm-bottom', edge2: 'bottom', reversed: true },
  { face1: 'right-arm-left', edge1: 'bottom', face2: 'right-arm-bottom', edge2: 'right', reversed: true },
  { face1: 'right-arm-right', edge1: 'bottom', face2: 'right-arm-bottom', edge2: 'left', reversed: true },
  { face1: 'right-arm-back', edge1: 'bottom', face2: 'right-arm-bottom', edge2: 'top', reversed: false },

  // === LEFT ARM (Layer 1) ===
  { face1: 'left-arm-front', edge1: 'left', face2: 'left-arm-right', edge2: 'right', reversed: false },
  { face1: 'left-arm-front', edge1: 'right', face2: 'left-arm-left', edge2: 'left', reversed: false },
  { face1: 'left-arm-left', edge1: 'right', face2: 'left-arm-back', edge2: 'left', reversed: false },
  { face1: 'left-arm-right', edge1: 'left', face2: 'left-arm-back', edge2: 'right', reversed: false },
  { face1: 'left-arm-front', edge1: 'top', face2: 'left-arm-top', edge2: 'bottom', reversed: false },
  { face1: 'left-arm-left', edge1: 'top', face2: 'left-arm-top', edge2: 'right', reversed: true },
  { face1: 'left-arm-right', edge1: 'top', face2: 'left-arm-top', edge2: 'left', reversed: true },
  { face1: 'left-arm-back', edge1: 'top', face2: 'left-arm-top', edge2: 'top', reversed: true },
  { face1: 'left-arm-front', edge1: 'bottom', face2: 'left-arm-bottom', edge2: 'bottom', reversed: true },
  { face1: 'left-arm-left', edge1: 'bottom', face2: 'left-arm-bottom', edge2: 'right', reversed: true },
  { face1: 'left-arm-right', edge1: 'bottom', face2: 'left-arm-bottom', edge2: 'left', reversed: true },
  { face1: 'left-arm-back', edge1: 'bottom', face2: 'left-arm-bottom', edge2: 'top', reversed: false },

  // === RIGHT LEG (Layer 1) ===
  { face1: 'right-leg-front', edge1: 'left', face2: 'right-leg-right', edge2: 'right', reversed: false },
  { face1: 'right-leg-front', edge1: 'right', face2: 'right-leg-left', edge2: 'left', reversed: false },
  { face1: 'right-leg-left', edge1: 'right', face2: 'right-leg-back', edge2: 'left', reversed: false },
  { face1: 'right-leg-right', edge1: 'left', face2: 'right-leg-back', edge2: 'right', reversed: false },
  { face1: 'right-leg-front', edge1: 'top', face2: 'right-leg-top', edge2: 'bottom', reversed: false },
  { face1: 'right-leg-left', edge1: 'top', face2: 'right-leg-top', edge2: 'right', reversed: true },
  { face1: 'right-leg-right', edge1: 'top', face2: 'right-leg-top', edge2: 'left', reversed: true },
  { face1: 'right-leg-back', edge1: 'top', face2: 'right-leg-top', edge2: 'top', reversed: true },
  { face1: 'right-leg-front', edge1: 'bottom', face2: 'right-leg-bottom', edge2: 'bottom', reversed: true },
  { face1: 'right-leg-left', edge1: 'bottom', face2: 'right-leg-bottom', edge2: 'right', reversed: true },
  { face1: 'right-leg-right', edge1: 'bottom', face2: 'right-leg-bottom', edge2: 'left', reversed: true },
  { face1: 'right-leg-back', edge1: 'bottom', face2: 'right-leg-bottom', edge2: 'top', reversed: false },

  // === LEFT LEG (Layer 1) ===
  { face1: 'left-leg-front', edge1: 'left', face2: 'left-leg-right', edge2: 'right', reversed: false },
  { face1: 'left-leg-front', edge1: 'right', face2: 'left-leg-left', edge2: 'left', reversed: false },
  { face1: 'left-leg-left', edge1: 'right', face2: 'left-leg-back', edge2: 'left', reversed: false },
  { face1: 'left-leg-right', edge1: 'left', face2: 'left-leg-back', edge2: 'right', reversed: false },
  { face1: 'left-leg-front', edge1: 'top', face2: 'left-leg-top', edge2: 'bottom', reversed: false },
  { face1: 'left-leg-left', edge1: 'top', face2: 'left-leg-top', edge2: 'right', reversed: true },
  { face1: 'left-leg-right', edge1: 'top', face2: 'left-leg-top', edge2: 'left', reversed: true },
  { face1: 'left-leg-back', edge1: 'top', face2: 'left-leg-top', edge2: 'top', reversed: true },
  { face1: 'left-leg-front', edge1: 'bottom', face2: 'left-leg-bottom', edge2: 'bottom', reversed: true },
  { face1: 'left-leg-left', edge1: 'bottom', face2: 'left-leg-bottom', edge2: 'right', reversed: true },
  { face1: 'left-leg-right', edge1: 'bottom', face2: 'left-leg-bottom', edge2: 'left', reversed: true },
  { face1: 'left-leg-back', edge1: 'bottom', face2: 'left-leg-bottom', edge2: 'top', reversed: false },

  // === HAT (Layer 2) ===
  { face1: 'hat-front', edge1: 'left', face2: 'hat-right', edge2: 'right', reversed: false },
  { face1: 'hat-front', edge1: 'right', face2: 'hat-left', edge2: 'left', reversed: false },
  { face1: 'hat-left', edge1: 'right', face2: 'hat-back', edge2: 'left', reversed: false },
  { face1: 'hat-right', edge1: 'left', face2: 'hat-back', edge2: 'right', reversed: false },
  { face1: 'hat-front', edge1: 'top', face2: 'hat-top', edge2: 'bottom', reversed: false },
  { face1: 'hat-left', edge1: 'top', face2: 'hat-top', edge2: 'right', reversed: true },
  { face1: 'hat-right', edge1: 'top', face2: 'hat-top', edge2: 'left', reversed: true },
  { face1: 'hat-back', edge1: 'top', face2: 'hat-top', edge2: 'top', reversed: true },
  { face1: 'hat-front', edge1: 'bottom', face2: 'hat-bottom', edge2: 'bottom', reversed: true },
  { face1: 'hat-left', edge1: 'bottom', face2: 'hat-bottom', edge2: 'right', reversed: true },
  { face1: 'hat-right', edge1: 'bottom', face2: 'hat-bottom', edge2: 'left', reversed: true },
  { face1: 'hat-back', edge1: 'bottom', face2: 'hat-bottom', edge2: 'top', reversed: false },

  // === JACKET (Layer 2) ===
  { face1: 'jacket-front', edge1: 'left', face2: 'jacket-right', edge2: 'right', reversed: false },
  { face1: 'jacket-front', edge1: 'right', face2: 'jacket-left', edge2: 'left', reversed: false },
  { face1: 'jacket-left', edge1: 'right', face2: 'jacket-back', edge2: 'left', reversed: false },
  { face1: 'jacket-right', edge1: 'left', face2: 'jacket-back', edge2: 'right', reversed: false },
  { face1: 'jacket-front', edge1: 'top', face2: 'jacket-top', edge2: 'bottom', reversed: false },
  { face1: 'jacket-left', edge1: 'top', face2: 'jacket-top', edge2: 'right', reversed: true },
  { face1: 'jacket-right', edge1: 'top', face2: 'jacket-top', edge2: 'left', reversed: true },
  { face1: 'jacket-back', edge1: 'top', face2: 'jacket-top', edge2: 'top', reversed: true },
  { face1: 'jacket-front', edge1: 'bottom', face2: 'jacket-bottom', edge2: 'bottom', reversed: true },
  { face1: 'jacket-left', edge1: 'bottom', face2: 'jacket-bottom', edge2: 'right', reversed: true },
  { face1: 'jacket-right', edge1: 'bottom', face2: 'jacket-bottom', edge2: 'left', reversed: true },
  { face1: 'jacket-back', edge1: 'bottom', face2: 'jacket-bottom', edge2: 'top', reversed: false },

  // === RIGHT SLEEVE (Layer 2) ===
  { face1: 'right-sleeve-front', edge1: 'left', face2: 'right-sleeve-right', edge2: 'right', reversed: false },
  { face1: 'right-sleeve-front', edge1: 'right', face2: 'right-sleeve-left', edge2: 'left', reversed: false },
  { face1: 'right-sleeve-left', edge1: 'right', face2: 'right-sleeve-back', edge2: 'left', reversed: false },
  { face1: 'right-sleeve-right', edge1: 'left', face2: 'right-sleeve-back', edge2: 'right', reversed: false },
  { face1: 'right-sleeve-front', edge1: 'top', face2: 'right-sleeve-top', edge2: 'bottom', reversed: false },
  { face1: 'right-sleeve-left', edge1: 'top', face2: 'right-sleeve-top', edge2: 'right', reversed: true },
  { face1: 'right-sleeve-right', edge1: 'top', face2: 'right-sleeve-top', edge2: 'left', reversed: true },
  { face1: 'right-sleeve-back', edge1: 'top', face2: 'right-sleeve-top', edge2: 'top', reversed: true },
  { face1: 'right-sleeve-front', edge1: 'bottom', face2: 'right-sleeve-bottom', edge2: 'bottom', reversed: true },
  { face1: 'right-sleeve-left', edge1: 'bottom', face2: 'right-sleeve-bottom', edge2: 'right', reversed: true },
  { face1: 'right-sleeve-right', edge1: 'bottom', face2: 'right-sleeve-bottom', edge2: 'left', reversed: true },
  { face1: 'right-sleeve-back', edge1: 'bottom', face2: 'right-sleeve-bottom', edge2: 'top', reversed: false },

  // === LEFT SLEEVE (Layer 2) ===
  { face1: 'left-sleeve-front', edge1: 'left', face2: 'left-sleeve-right', edge2: 'right', reversed: false },
  { face1: 'left-sleeve-front', edge1: 'right', face2: 'left-sleeve-left', edge2: 'left', reversed: false },
  { face1: 'left-sleeve-left', edge1: 'right', face2: 'left-sleeve-back', edge2: 'left', reversed: false },
  { face1: 'left-sleeve-right', edge1: 'left', face2: 'left-sleeve-back', edge2: 'right', reversed: false },
  { face1: 'left-sleeve-front', edge1: 'top', face2: 'left-sleeve-top', edge2: 'bottom', reversed: false },
  { face1: 'left-sleeve-left', edge1: 'top', face2: 'left-sleeve-top', edge2: 'right', reversed: true },
  { face1: 'left-sleeve-right', edge1: 'top', face2: 'left-sleeve-top', edge2: 'left', reversed: true },
  { face1: 'left-sleeve-back', edge1: 'top', face2: 'left-sleeve-top', edge2: 'top', reversed: true },
  { face1: 'left-sleeve-front', edge1: 'bottom', face2: 'left-sleeve-bottom', edge2: 'bottom', reversed: true },
  { face1: 'left-sleeve-left', edge1: 'bottom', face2: 'left-sleeve-bottom', edge2: 'right', reversed: true },
  { face1: 'left-sleeve-right', edge1: 'bottom', face2: 'left-sleeve-bottom', edge2: 'left', reversed: true },
  { face1: 'left-sleeve-back', edge1: 'bottom', face2: 'left-sleeve-bottom', edge2: 'top', reversed: false },

  // === RIGHT PANTS (Layer 2) ===
  { face1: 'right-pants-front', edge1: 'left', face2: 'right-pants-right', edge2: 'right', reversed: false },
  { face1: 'right-pants-front', edge1: 'right', face2: 'right-pants-left', edge2: 'left', reversed: false },
  { face1: 'right-pants-left', edge1: 'right', face2: 'right-pants-back', edge2: 'left', reversed: false },
  { face1: 'right-pants-right', edge1: 'left', face2: 'right-pants-back', edge2: 'right', reversed: false },
  { face1: 'right-pants-front', edge1: 'top', face2: 'right-pants-top', edge2: 'bottom', reversed: false },
  { face1: 'right-pants-left', edge1: 'top', face2: 'right-pants-top', edge2: 'right', reversed: true },
  { face1: 'right-pants-right', edge1: 'top', face2: 'right-pants-top', edge2: 'left', reversed: true },
  { face1: 'right-pants-back', edge1: 'top', face2: 'right-pants-top', edge2: 'top', reversed: true },
  { face1: 'right-pants-front', edge1: 'bottom', face2: 'right-pants-bottom', edge2: 'bottom', reversed: true },
  { face1: 'right-pants-left', edge1: 'bottom', face2: 'right-pants-bottom', edge2: 'right', reversed: true },
  { face1: 'right-pants-right', edge1: 'bottom', face2: 'right-pants-bottom', edge2: 'left', reversed: true },
  { face1: 'right-pants-back', edge1: 'bottom', face2: 'right-pants-bottom', edge2: 'top', reversed: false },

  // === LEFT PANTS (Layer 2) ===
  { face1: 'left-pants-front', edge1: 'left', face2: 'left-pants-right', edge2: 'right', reversed: false },
  { face1: 'left-pants-front', edge1: 'right', face2: 'left-pants-left', edge2: 'left', reversed: false },
  { face1: 'left-pants-left', edge1: 'right', face2: 'left-pants-back', edge2: 'left', reversed: false },
  { face1: 'left-pants-right', edge1: 'left', face2: 'left-pants-back', edge2: 'right', reversed: false },
  { face1: 'left-pants-front', edge1: 'top', face2: 'left-pants-top', edge2: 'bottom', reversed: false },
  { face1: 'left-pants-left', edge1: 'top', face2: 'left-pants-top', edge2: 'right', reversed: true },
  { face1: 'left-pants-right', edge1: 'top', face2: 'left-pants-top', edge2: 'left', reversed: true },
  { face1: 'left-pants-back', edge1: 'top', face2: 'left-pants-top', edge2: 'top', reversed: true },
  { face1: 'left-pants-front', edge1: 'bottom', face2: 'left-pants-bottom', edge2: 'bottom', reversed: true },
  { face1: 'left-pants-left', edge1: 'bottom', face2: 'left-pants-bottom', edge2: 'right', reversed: true },
  { face1: 'left-pants-right', edge1: 'bottom', face2: 'left-pants-bottom', edge2: 'left', reversed: true },
  { face1: 'left-pants-back', edge1: 'bottom', face2: 'left-pants-bottom', edge2: 'top', reversed: false },
];

// Get edge pixels for a skin region
function getEdgePixels(
  region: SkinRegion,
  edge: EdgeDirection
): { x: number; y: number }[] {
  const pixels: { x: number; y: number }[] = [];

  switch (edge) {
    case 'top':
      for (let x = region.x; x < region.x + region.width; x++) {
        pixels.push({ x, y: region.y });
      }
      break;
    case 'bottom':
      for (let x = region.x; x < region.x + region.width; x++) {
        pixels.push({ x, y: region.y + region.height - 1 });
      }
      break;
    case 'left':
      for (let y = region.y; y < region.y + region.height; y++) {
        pixels.push({ x: region.x, y });
      }
      break;
    case 'right':
      for (let y = region.y; y < region.y + region.height; y++) {
        pixels.push({ x: region.x + region.width - 1, y });
      }
      break;
  }

  return pixels;
}

// Build a map of skin part name -> SkinRegion for quick lookup
function buildSkinPartMap(): Map<string, SkinRegion> {
  const map = new Map<string, SkinRegion>();
  for (const part of SKIN_PARTS) {
    map.set(part.name, part);
  }
  return map;
}

// Get all 3D-adjacent pixel pairs from UV edge connections
function get3DAdjacentPixelPairs(): { p1: { x: number; y: number }; p2: { x: number; y: number } }[] {
  const pairs: { p1: { x: number; y: number }; p2: { x: number; y: number } }[] = [];
  const skinPartMap = buildSkinPartMap();

  for (const connection of UV_EDGE_CONNECTIONS) {
    const region1 = skinPartMap.get(connection.face1);
    const region2 = skinPartMap.get(connection.face2);

    if (!region1 || !region2) continue;

    const edge1Pixels = getEdgePixels(region1, connection.edge1);
    const edge2Pixels = getEdgePixels(region2, connection.edge2);

    // Edges should have same length for proper mapping
    const minLen = Math.min(edge1Pixels.length, edge2Pixels.length);

    for (let i = 0; i < minLen; i++) {
      const p1 = edge1Pixels[i];
      const p2Index = connection.reversed ? (minLen - 1 - i) : i;
      const p2 = edge2Pixels[p2Index];

      if (p1 && p2) {
        pairs.push({ p1, p2 });
      }
    }
  }

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
      // Both pixels must be within same body part (handled by UV_EDGE_CONNECTIONS definition)
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

/**
 * Merge similar layers (optional post-processing).
 * Returns new layers with merged pixel data.
 */
export function mergeSimilarLayers(
  layers: Layer[],
  threshold: number = COLOR_SIMILARITY_THRESHOLD,
  applyNoiseFromThreshold = true
): { layers: Layer[] } {
  if (layers.length <= 1) return { layers: layers.map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) })) };

  const noiseSettings = applyNoiseFromThreshold
    ? calculateNoiseFromThreshold(threshold)
    : null;

  // Map old layer ID to new layer (for merged layers)
  const mergeMap = new Map<string, Layer>();
  const newLayers: Layer[] = [];

  for (const layer of layers) {
    // Find if there's an existing layer with similar color
    let mergedInto: Layer | null = null;
    for (const existingLayer of newLayers) {
      if (areColorsSimilar(layer.baseColor, existingLayer.baseColor, threshold)) {
        mergedInto = existingLayer;
        break;
      }
    }

    if (mergedInto) {
      // Merge pixels into the existing layer
      for (let y = 0; y < SKIN_HEIGHT; y++) {
        for (let x = 0; x < SKIN_WIDTH; x++) {
          const pixel = layer.pixels[y][x];
          if (pixel && (!mergedInto.pixels[y][x] || mergedInto.pixels[y][x]!.a === 0)) {
            mergedInto.pixels[y][x] = { ...pixel };
          }
        }
      }
      mergeMap.set(layer.id, mergedInto);
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
      mergeMap.set(layer.id, newLayer);
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
  targetLayerId: string
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
      // Clone target layer and merge source pixels into it
      const mergedPixels = cloneLayerPixels(layer.pixels);
      for (let y = 0; y < SKIN_HEIGHT; y++) {
        for (let x = 0; x < SKIN_WIDTH; x++) {
          const sourcePixel = sourceLayer.pixels[y][x];
          if (sourcePixel && sourcePixel.a > 0) {
            // Source pixel takes priority (drawn on top)
            mergedPixels[y][x] = { ...sourcePixel };
          }
        }
      }
      newLayers.push({ ...layer, pixels: mergedPixels });
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

  // Create new layers for each component
  const newLayers: Layer[] = layers
    .filter(l => l.id !== layerId)
    .map(l => ({ ...l, pixels: cloneLayerPixels(l.pixels) }));

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
      groupId: null,
      order: newLayers.length,
      layerType: layer.layerType,
      visible: true,
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

  const newLayerId = generateId();
  const maxOrder = layers.length > 0 ? Math.max(...layers.map(l => l.order)) : -1;
  const newLayer: Layer = {
    id: newLayerId,
    name: `${layer.name}-split`,
    baseColor: avgColor,
    noiseSettings: { ...layer.noiseSettings },
    groupId: layer.groupId,
    order: maxOrder + 1,
    layerType: layer.layerType,
    visible: true,
    opacity: layer.opacity ?? 100,
    pixels: newLayerPixels,
  };

  // Create new layers array, removing selected pixels from source layer
  const newLayers: Layer[] = [];
  for (const l of layers) {
    if (l.id === layerId) {
      // Clone source layer and remove selected pixels
      const clonedPixels = cloneLayerPixels(l.pixels);
      for (const p of validPixels) {
        clonedPixels[p.y][p.x] = null;
      }
      newLayers.push({ ...l, pixels: clonedPixels });
    } else {
      newLayers.push({ ...l, pixels: cloneLayerPixels(l.pixels) });
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
