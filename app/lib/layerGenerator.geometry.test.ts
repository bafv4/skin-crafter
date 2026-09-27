// 自動生成が使う「3D で隣り合うピクセル」が、3D プレビューの実際の形状と一致することを確かめる
// （Preview3D.client.tsx の createSkinGeometry で作った three.js の箱から隣接を求めて比較する）
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { get3DAdjacentPixelPairs } from './layerGenerator';
import { createSkinGeometry } from '../components/editor/Preview3D.client';

// Preview3D.client はストア経由で PixelEngine を読み込むので、Web Worker を起動しないようモックする
vi.mock('./pixelEngine', () => import('../test/pixelEngineMock'));
import { SKIN_HEIGHT, SKIN_PARTS, SKIN_WIDTH, type SkinRegion } from '../types/editor';

type Rect = [number, number, number, number];
const FACES = ['front', 'back', 'top', 'bottom', 'right', 'left'] as const;
// three.js BoxGeometry の面の順番（+X, -X, +Y, -Y, +Z, -Z）と、Preview3D が貼るテクスチャの面
const BOX_FACE_ORDER = ['left', 'right', 'top', 'bottom', 'front', 'back'] as const;

function partsOf(): Map<string, Map<string, SkinRegion>> {
  const parts = new Map<string, Map<string, SkinRegion>>();
  for (const region of SKIN_PARTS) {
    const i = region.name.lastIndexOf('-');
    const part = region.name.slice(0, i);
    if (!parts.has(part)) parts.set(part, new Map());
    parts.get(part)!.set(region.name.slice(i + 1), region);
  }
  return parts;
}

// 箱の各面について、テクスチャ上のピクセル中心 → 3D 座標（面は軸に平行な長方形なので線形補間で求まる）
function adjacencyFromPreviewGeometry(faces: Map<string, SkinRegion>): Set<string> {
  const rect = (r: SkinRegion): Rect => [r.x, r.y, r.width, r.height];
  const uvMap = Object.fromEntries(FACES.map((f) => [f, rect(faces.get(f)!)])) as Record<(typeof FACES)[number], Rect>;
  const w = faces.get('front')!.width;
  const h = faces.get('front')!.height;
  const d = faces.get('right')!.width;
  const geometry = createSkinGeometry(w, h, d, uvMap);
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');

  const points: { face: string; key: string; p: number[] }[] = [];
  BOX_FACE_ORDER.forEach((face, fi) => {
    const verts = [0, 1, 2, 3].map((k) => ({
      p: [pos.getX(fi * 4 + k), pos.getY(fi * 4 + k), pos.getZ(fi * 4 + k)],
      // UV（下が 0）→ 画像座標（上が 0）
      // （UV は面の内側に少し寄せてあるので、最も近いピクセル境界に丸める）
      img: [Math.round(uv.getX(fi * 4 + k) * SKIN_WIDTH), Math.round((1 - uv.getY(fi * 4 + k)) * SKIN_HEIGHT)],
    }));
    const region = faces.get(face)!;
    // 画像座標の x・y それぞれに対して 3D 座標が線形に変わる向きを、頂点から求める
    const origin = verts[0];
    const alongX = verts.find((v) => v.img[1] === origin.img[1] && v.img[0] !== origin.img[0])!;
    const alongY = verts.find((v) => v.img[0] === origin.img[0] && v.img[1] !== origin.img[1])!;
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const sx = (x + 0.5 - origin.img[0]) / (alongX.img[0] - origin.img[0]);
        const sy = (y + 0.5 - origin.img[1]) / (alongY.img[1] - origin.img[1]);
        const p = [0, 1, 2].map(
          (k) => origin.p[k] + (alongX.p[k] - origin.p[k]) * sx + (alongY.p[k] - origin.p[k]) * sy
        );
        points.push({ face, key: `${x},${y}`, p });
      }
    }
  });
  geometry.dispose();

  const pairs = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[i].face === points[j].face) continue;
      const dist2 = points[i].p.reduce((sum, v, k) => sum + (v - points[j].p[k]) ** 2, 0);
      if (Math.abs(dist2 - 0.5) < 1e-6) pairs.add([points[i].key, points[j].key].sort().join('|'));
    }
  }
  return pairs;
}

describe('3D で隣り合うピクセルと 3D プレビューの形状の一致', () => {
  const generated = new Set(
    get3DAdjacentPixelPairs().map(({ p1, p2 }) => [`${p1.x},${p1.y}`, `${p2.x},${p2.y}`].sort().join('|'))
  );

  it.each([...partsOf().entries()])('%s', (_part, faces) => {
    const expected = adjacencyFromPreviewGeometry(faces);
    const partKeys = new Set<string>();
    for (const region of faces.values()) {
      for (let y = region.y; y < region.y + region.height; y++)
        for (let x = region.x; x < region.x + region.width; x++) partKeys.add(`${x},${y}`);
    }
    const actual = new Set([...generated].filter((pair) => partKeys.has(pair.split('|')[0])));
    expect(expected.size).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });
});
