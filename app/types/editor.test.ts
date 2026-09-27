import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_CANVAS_BACKGROUND,
  MAX_HISTORY,
  SKIN_HEIGHT,
  SKIN_PARTS,
  SKIN_WIDTH,
  cloneLayerPixels,
  createEmptyLayerPixels,
  createEmptyPixels,
  generateId,
  getSkinParts,
  hexToRgba,
  rgbaToHex,
  type LayerPixels,
  type ModelType,
  type RGBA,
  type SkinRegion,
} from './editor';

// ---------------------------------------------------------------------------
// テスト用ヘルパー
// ---------------------------------------------------------------------------

// 2つの矩形が1ピクセルでも重なっているか
function overlaps(a: SkinRegion, b: SkinRegion): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// 領域が占めるピクセル座標をすべて列挙する
function pixelsOf(region: SkinRegion): string[] {
  const result: string[] = [];
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      result.push(`${x},${y}`);
    }
  }
  return result;
}

function byName(parts: SkinRegion[], name: string): SkinRegion {
  const part = parts.find((p) => p.name === name);
  if (!part) throw new Error(`部位が見つからない: ${name}`);
  return part;
}

// 再現性のある疑似乱数（mulberry32）
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'] as const;

// 各ボックス（部位）の UV 原点と寸法（W=幅, H=高さ, D=奥行き）
// Minecraft の標準 64x64 スキン形式に基づく
interface BoxSpec {
  part: string;
  layer: 1 | 2;
  ox: number;
  oy: number;
  w: number;
  h: number;
  d: number;
  isArm: boolean;
}

const BOXES: BoxSpec[] = [
  { part: 'head', layer: 1, ox: 0, oy: 0, w: 8, h: 8, d: 8, isArm: false },
  { part: 'body', layer: 1, ox: 16, oy: 16, w: 8, h: 12, d: 4, isArm: false },
  { part: 'right-arm', layer: 1, ox: 40, oy: 16, w: 4, h: 12, d: 4, isArm: true },
  { part: 'left-arm', layer: 1, ox: 32, oy: 48, w: 4, h: 12, d: 4, isArm: true },
  { part: 'right-leg', layer: 1, ox: 0, oy: 16, w: 4, h: 12, d: 4, isArm: false },
  { part: 'left-leg', layer: 1, ox: 16, oy: 48, w: 4, h: 12, d: 4, isArm: false },
  { part: 'hat', layer: 2, ox: 32, oy: 0, w: 8, h: 8, d: 8, isArm: false },
  { part: 'jacket', layer: 2, ox: 16, oy: 32, w: 8, h: 12, d: 4, isArm: false },
  { part: 'right-sleeve', layer: 2, ox: 40, oy: 32, w: 4, h: 12, d: 4, isArm: true },
  { part: 'left-sleeve', layer: 2, ox: 48, oy: 48, w: 4, h: 12, d: 4, isArm: true },
  { part: 'right-pants', layer: 2, ox: 0, oy: 32, w: 4, h: 12, d: 4, isArm: false },
  { part: 'left-pants', layer: 2, ox: 0, oy: 48, w: 4, h: 12, d: 4, isArm: false },
];

// ボックスの展開図から各面の期待矩形を計算する
function expectedFaces(box: BoxSpec, width: number): Record<(typeof FACES)[number], Omit<SkinRegion, 'name' | 'layer'>> {
  const { ox, oy, h, d } = box;
  const w = width;
  return {
    top: { x: ox + d, y: oy, width: w, height: d },
    bottom: { x: ox + d + w, y: oy, width: w, height: d },
    right: { x: ox, y: oy + d, width: d, height: h },
    front: { x: ox + d, y: oy + d, width: w, height: h },
    left: { x: ox + d + w, y: oy + d, width: d, height: h },
    back: { x: ox + d + w + d, y: oy + d, width: w, height: h },
  };
}

const MODELS: ModelType[] = ['steve', 'alex'];

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

describe('定数', () => {
  it('スキンサイズは 64x64', () => {
    expect(SKIN_WIDTH).toBe(64);
    expect(SKIN_HEIGHT).toBe(64);
  });

  it('履歴の最大件数は正の整数', () => {
    expect(Number.isInteger(MAX_HISTORY)).toBe(true);
    expect(MAX_HISTORY).toBeGreaterThan(0);
  });

  it('DEFAULT_CANVAS_BACKGROUND は明るいチェッカー柄', () => {
    expect(DEFAULT_CANVAS_BACKGROUND).toEqual({ type: 'checker', variant: 'light' });
  });
});

// ---------------------------------------------------------------------------
// rgbaToHex / hexToRgba
// ---------------------------------------------------------------------------

describe('rgbaToHex', () => {
  it('RGB を #rrggbb 形式に変換する', () => {
    expect(rgbaToHex({ r: 255, g: 128, b: 0, a: 255 })).toBe('#ff8000');
    expect(rgbaToHex({ r: 18, g: 52, b: 86, a: 255 })).toBe('#123456');
  });

  it('1桁の16進数は 0 埋めされる', () => {
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 255 })).toBe('#000000');
    expect(rgbaToHex({ r: 1, g: 10, b: 15, a: 255 })).toBe('#010a0f');
  });

  it('出力は常に小文字', () => {
    const hex = rgbaToHex({ r: 171, g: 205, b: 239, a: 255 });
    expect(hex).toBe('#abcdef');
    expect(hex).toBe(hex.toLowerCase());
  });

  it('アルファ値は出力に含まれない', () => {
    const opaque = rgbaToHex({ r: 10, g: 20, b: 30, a: 255 });
    const transparent = rgbaToHex({ r: 10, g: 20, b: 30, a: 0 });
    expect(opaque).toBe('#0a141e');
    expect(transparent).toBe(opaque);
  });

  it('0〜255 の整数なら常に7文字の #rrggbb になる', () => {
    for (let v = 0; v <= 255; v++) {
      expect(rgbaToHex({ r: v, g: 255 - v, b: v, a: 255 })).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('hexToRgba', () => {
  it('#rrggbb を RGBA に変換し、アルファは既定で 255', () => {
    expect(hexToRgba('#ff8000')).toEqual({ r: 255, g: 128, b: 0, a: 255 });
  });

  it('先頭の # は省略できる', () => {
    expect(hexToRgba('123456')).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it('大文字・小文字・混在を区別しない', () => {
    const expected = { r: 171, g: 205, b: 239, a: 255 };
    expect(hexToRgba('#abcdef')).toEqual(expected);
    expect(hexToRgba('#ABCDEF')).toEqual(expected);
    expect(hexToRgba('#AbCdEf')).toEqual(expected);
  });

  it('alpha 引数がそのまま a に入る', () => {
    expect(hexToRgba('#ffffff', 0)).toEqual({ r: 255, g: 255, b: 255, a: 0 });
    expect(hexToRgba('#ffffff', 128)).toEqual({ r: 255, g: 255, b: 255, a: 128 });
  });

  it('黒と白の境界値を正しく変換する', () => {
    expect(hexToRgba('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(hexToRgba('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  describe('不正な入力', () => {
    const invalidInputs: [string, string][] = [
      ['空文字列', ''],
      ['# のみ', '#'],
      ['3桁の短縮形', '#fff'],
      ['8桁（アルファ付き）', '#ff000080'],
      ['5桁', '#12345'],
      ['7桁', '#1234567'],
      ['16進数以外の文字', '#gggggg'],
      ['前後の空白', ' #ff0000 '],
      ['# が2つ', '##ff0000'],
      ['色名', 'red'],
      ['rgb() 表記', 'rgb(255, 0, 0)'],
    ];

    it.each(invalidInputs)('%s は黒（指定アルファ）にフォールバックする', (_label, input) => {
      expect(hexToRgba(input)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
      expect(hexToRgba(input, 42)).toEqual({ r: 0, g: 0, b: 0, a: 42 });
    });
  });

  it('不正入力のたびに新しいオブジェクトを返す（共有されない）', () => {
    const a = hexToRgba('invalid');
    const b = hexToRgba('invalid');
    expect(a).not.toBe(b);
    a.r = 99;
    expect(b.r).toBe(0);
  });
});

describe('rgbaToHex と hexToRgba の往復変換', () => {
  it('hex → RGBA → hex で元の（小文字の）値に戻る', () => {
    for (const hex of ['#000000', '#ffffff', '#010203', '#7f80ff', '#abcdef', '#ABCDEF']) {
      expect(rgbaToHex(hexToRgba(hex))).toBe(hex.toLowerCase());
    }
  });

  it('RGBA → hex → RGBA で RGB が保たれ、アルファは引数で復元される', () => {
    const random = seededRandom(12345);
    for (let i = 0; i < 500; i++) {
      const color: RGBA = {
        r: Math.floor(random() * 256),
        g: Math.floor(random() * 256),
        b: Math.floor(random() * 256),
        a: Math.floor(random() * 256),
      };
      expect(hexToRgba(rgbaToHex(color), color.a)).toEqual(color);
    }
  });

  it('各チャンネルの全値 0〜255 で往復変換が一致する', () => {
    for (let v = 0; v <= 255; v++) {
      const color: RGBA = { r: v, g: (v * 7) % 256, b: 255 - v, a: 255 };
      expect(hexToRgba(rgbaToHex(color))).toEqual(color);
    }
  });
});

// ---------------------------------------------------------------------------
// SKIN_PARTS
// ---------------------------------------------------------------------------

describe('SKIN_PARTS', () => {
  it('12部位 × 6面 = 72 領域', () => {
    expect(SKIN_PARTS).toHaveLength(72);
  });

  it('領域名はすべて一意', () => {
    const names = SKIN_PARTS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('各部位に top/bottom/right/front/left/back の6面がそろっている', () => {
    const expectedNames = BOXES.flatMap((box) => FACES.map((face) => `${box.part}-${face}`));
    expect(SKIN_PARTS.map((p) => p.name).sort()).toEqual([...expectedNames].sort());
  });

  it('レイヤー1（本体）とレイヤー2（オーバーレイ）がそれぞれ36領域', () => {
    expect(SKIN_PARTS.filter((p) => p.layer === 1)).toHaveLength(36);
    expect(SKIN_PARTS.filter((p) => p.layer === 2)).toHaveLength(36);
  });

  it('各部位の layer 値が本体/オーバーレイの区分と一致する', () => {
    for (const box of BOXES) {
      for (const face of FACES) {
        expect(byName(SKIN_PARTS, `${box.part}-${face}`).layer).toBe(box.layer);
      }
    }
  });

  it('座標・サイズはすべて正の整数', () => {
    for (const part of SKIN_PARTS) {
      expect(Number.isInteger(part.x)).toBe(true);
      expect(Number.isInteger(part.y)).toBe(true);
      expect(Number.isInteger(part.width)).toBe(true);
      expect(Number.isInteger(part.height)).toBe(true);
      expect(part.width).toBeGreaterThan(0);
      expect(part.height).toBeGreaterThan(0);
    }
  });

  it('各部位の6面が標準のボックス展開図どおりに配置されている', () => {
    for (const box of BOXES) {
      const faces = expectedFaces(box, box.w);
      for (const face of FACES) {
        const part = byName(SKIN_PARTS, `${box.part}-${face}`);
        expect({ name: part.name, x: part.x, y: part.y, width: part.width, height: part.height }).toEqual({
          name: `${box.part}-${face}`,
          ...faces[face],
        });
      }
    }
  });

  it('向かい合う面（top/bottom, right/left, front/back）は同じサイズ', () => {
    for (const box of BOXES) {
      const get = (face: string) => byName(SKIN_PARTS, `${box.part}-${face}`);
      for (const [a, b] of [
        ['top', 'bottom'],
        ['right', 'left'],
        ['front', 'back'],
      ]) {
        expect([get(a).width, get(a).height]).toEqual([get(b).width, get(b).height]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getSkinParts
// ---------------------------------------------------------------------------

describe('getSkinParts', () => {
  it('steve は SKIN_PARTS をそのまま返す', () => {
    expect(getSkinParts('steve')).toEqual(SKIN_PARTS);
  });

  it('alex も同じ領域名を同じ順序で返す', () => {
    expect(getSkinParts('alex').map((p) => p.name)).toEqual(SKIN_PARTS.map((p) => p.name));
  });

  it('alex を取得しても SKIN_PARTS（steve）は変更されない', () => {
    const before = structuredClone(SKIN_PARTS);
    getSkinParts('alex');
    getSkinParts('alex');
    expect(SKIN_PARTS).toEqual(before);
    expect(getSkinParts('steve')).toEqual(before);
  });

  it('alex で腕・袖以外の領域は steve と完全に一致する', () => {
    const steve = getSkinParts('steve');
    const alex = getSkinParts('alex');
    const armParts = new Set(BOXES.filter((b) => b.isArm).map((b) => b.part));
    for (let i = 0; i < steve.length; i++) {
      const part = steve[i].name.replace(/-(top|bottom|right|front|left|back)$/, '');
      if (!armParts.has(part)) {
        expect(alex[i]).toEqual(steve[i]);
      }
    }
  });

  it('腕・袖の幅は steve が 4px、alex が 3px（高さ・奥行き・y 座標・layer は共通）', () => {
    const steve = getSkinParts('steve');
    const alex = getSkinParts('alex');
    for (const box of BOXES.filter((b) => b.isArm)) {
      const s = (face: string) => byName(steve, `${box.part}-${face}`);
      const a = (face: string) => byName(alex, `${box.part}-${face}`);

      // 幅方向の面（top/bottom/front/back）は 4px → 3px
      for (const face of ['top', 'bottom', 'front', 'back']) {
        expect(s(face).width).toBe(4);
        expect(a(face).width).toBe(3);
      }
      // 奥行き方向の面（right/left）の幅は 4px のまま
      for (const face of ['right', 'left']) {
        expect(s(face).width).toBe(4);
        expect(a(face).width).toBe(4);
      }
      for (const face of FACES) {
        expect(a(face).height).toBe(s(face).height);
        expect(a(face).y).toBe(s(face).y);
        expect(a(face).layer).toBe(s(face).layer);
      }
    }
  });

  it('alex の腕・袖は幅 3px のボックス展開図どおりに詰めて配置される', () => {
    const alex = getSkinParts('alex');
    for (const box of BOXES.filter((b) => b.isArm)) {
      const faces = expectedFaces(box, 3);
      for (const face of FACES) {
        const part = byName(alex, `${box.part}-${face}`);
        expect({ x: part.x, y: part.y, width: part.width, height: part.height }).toEqual(faces[face]);
      }
    }
  });

  it('alex の右腕は Minecraft スリムモデルの UV 座標と一致する', () => {
    const alex = getSkinParts('alex');
    const pick = (name: string) => {
      const { x, y, width, height } = byName(alex, name);
      return { x, y, width, height };
    };
    expect(pick('right-arm-top')).toEqual({ x: 44, y: 16, width: 3, height: 4 });
    expect(pick('right-arm-bottom')).toEqual({ x: 47, y: 16, width: 3, height: 4 });
    expect(pick('right-arm-right')).toEqual({ x: 40, y: 20, width: 4, height: 12 });
    expect(pick('right-arm-front')).toEqual({ x: 44, y: 20, width: 3, height: 12 });
    expect(pick('right-arm-left')).toEqual({ x: 47, y: 20, width: 4, height: 12 });
    expect(pick('right-arm-back')).toEqual({ x: 51, y: 20, width: 3, height: 12 });
  });

  it('alex の各腕・袖の面の合計面積は steve より小さい（幅 1px 分 × 面）', () => {
    const area = (parts: SkinRegion[], prefix: string) =>
      parts.filter((p) => p.name.startsWith(`${prefix}-`)).reduce((sum, p) => sum + p.width * p.height, 0);
    for (const box of BOXES.filter((b) => b.isArm)) {
      // top/bottom: 1×4 ずつ、front/back: 1×12 ずつ減る
      expect(area(getSkinParts('steve'), box.part) - area(getSkinParts('alex'), box.part)).toBe(4 + 4 + 12 + 12);
    }
  });

  describe.each(MODELS)('%s モデルの不変条件', (model) => {
    const parts = getSkinParts(model);

    it('すべての領域が 64x64 のキャンバス内に収まる', () => {
      for (const part of parts) {
        expect(part.x).toBeGreaterThanOrEqual(0);
        expect(part.y).toBeGreaterThanOrEqual(0);
        expect(part.x + part.width).toBeLessThanOrEqual(SKIN_WIDTH);
        expect(part.y + part.height).toBeLessThanOrEqual(SKIN_HEIGHT);
      }
    });

    it.each([1, 2] as const)('レイヤー%i の領域同士は重ならない', (layer) => {
      const regions = parts.filter((p) => p.layer === layer);
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          if (overlaps(regions[i], regions[j])) {
            throw new Error(`${regions[i].name} と ${regions[j].name} が重なっている`);
          }
        }
      }
    });

    it('レイヤーをまたいでも1ピクセルが複数の領域に属することはない', () => {
      const seen = new Map<string, string>();
      for (const part of parts) {
        for (const key of pixelsOf(part)) {
          const owner = seen.get(key);
          if (owner) throw new Error(`${key} が ${owner} と ${part.name} の両方に含まれている`);
          seen.set(key, part.name);
        }
      }
      expect(seen.size).toBe(parts.reduce((sum, p) => sum + p.width * p.height, 0));
    });

    it('領域名は一意', () => {
      const names = parts.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });
});

// ---------------------------------------------------------------------------
// ピクセル配列の生成・複製
// ---------------------------------------------------------------------------

describe('createEmptyLayerPixels', () => {
  it('64行 × 64列の配列を返す', () => {
    const pixels = createEmptyLayerPixels();
    expect(pixels).toHaveLength(SKIN_HEIGHT);
    for (const row of pixels) {
      expect(row).toHaveLength(SKIN_WIDTH);
    }
  });

  it('すべてのピクセルが null（透明）', () => {
    const pixels = createEmptyLayerPixels();
    expect(pixels.flat().every((p) => p === null)).toBe(true);
    expect(pixels.flat()).toHaveLength(SKIN_WIDTH * SKIN_HEIGHT);
  });

  it('疎配列ではなく全要素が実在する', () => {
    const pixels = createEmptyLayerPixels();
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        expect(x in pixels[y]).toBe(true);
      }
    }
  });

  it('各行は別々の配列（1行の変更が他の行に波及しない）', () => {
    const pixels = createEmptyLayerPixels();
    pixels[0][0] = { r: 1, g: 2, b: 3, a: 255 };
    expect(pixels[1][0]).toBeNull();
    expect(new Set(pixels).size).toBe(SKIN_HEIGHT);
  });

  it('呼び出すたびに独立した新しい配列を返す', () => {
    const a = createEmptyLayerPixels();
    const b = createEmptyLayerPixels();
    expect(a).not.toBe(b);
    a[5][5] = { r: 255, g: 0, b: 0, a: 255 };
    expect(b[5][5]).toBeNull();
  });
});

describe('createEmptyPixels', () => {
  it('64x64 のすべてのピクセルが layerId: null・透明黒', () => {
    const pixels = createEmptyPixels();
    expect(pixels).toHaveLength(SKIN_HEIGHT);
    for (const row of pixels) {
      expect(row).toHaveLength(SKIN_WIDTH);
      for (const pixel of row) {
        expect(pixel).toEqual({ layerId: null, color: { r: 0, g: 0, b: 0, a: 0 } });
      }
    }
  });

  it('各ピクセルとその color は独立したオブジェクト', () => {
    const pixels = createEmptyPixels();
    pixels[0][0].layerId = 'layer-1';
    pixels[0][0].color.r = 255;
    expect(pixels[0][1]).toEqual({ layerId: null, color: { r: 0, g: 0, b: 0, a: 0 } });
    expect(pixels[1][0]).toEqual({ layerId: null, color: { r: 0, g: 0, b: 0, a: 0 } });
    expect(pixels[0][1].color).not.toBe(pixels[0][0].color);
  });

  it('呼び出すたびに独立した新しい配列を返す', () => {
    const a = createEmptyPixels();
    const b = createEmptyPixels();
    a[10][10].color.a = 255;
    expect(b[10][10].color.a).toBe(0);
  });
});

describe('cloneLayerPixels', () => {
  function samplePixels(): LayerPixels {
    const pixels = createEmptyLayerPixels();
    pixels[0][0] = { r: 255, g: 0, b: 0, a: 255 };
    pixels[10][20] = { r: 1, g: 2, b: 3, a: 4 };
    pixels[63][63] = { r: 0, g: 0, b: 0, a: 0 };
    return pixels;
  }

  it('元と同じ内容（null も含む）の配列を返す', () => {
    const original = samplePixels();
    const clone = cloneLayerPixels(original);
    expect(clone).toEqual(original);
    expect(clone[1][1]).toBeNull();
  });

  it('外側の配列・各行・各ピクセルオブジェクトはすべて別インスタンス', () => {
    const original = samplePixels();
    const clone = cloneLayerPixels(original);
    expect(clone).not.toBe(original);
    for (let y = 0; y < original.length; y++) {
      expect(clone[y]).not.toBe(original[y]);
    }
    expect(clone[0][0]).not.toBe(original[0][0]);
    expect(clone[10][20]).not.toBe(original[10][20]);
  });

  it('クローン側のピクセルの色を書き換えても元は変わらない', () => {
    const original = samplePixels();
    const clone = cloneLayerPixels(original);
    clone[0][0]!.r = 7;
    clone[10][20]!.a = 200;
    expect(original[0][0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(original[10][20]).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  it('クローン側でピクセルの置換・消去・行の変更をしても元は変わらない', () => {
    const original = samplePixels();
    const snapshot = structuredClone(original);
    const clone = cloneLayerPixels(original);
    clone[0][0] = null;
    clone[1][1] = { r: 9, g: 9, b: 9, a: 9 };
    clone[2].fill({ r: 5, g: 5, b: 5, a: 5 });
    clone.pop();
    expect(original).toEqual(snapshot);
  });

  it('元を書き換えてもクローンは変わらない', () => {
    const original = samplePixels();
    const clone = cloneLayerPixels(original);
    original[0][0]!.g = 128;
    original[5][5] = { r: 1, g: 1, b: 1, a: 1 };
    expect(clone[0][0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(clone[5][5]).toBeNull();
  });

  it('透明（a: 0）の RGBA は null に変換されず RGBA のまま複製される', () => {
    const clone = cloneLayerPixels(samplePixels());
    expect(clone[63][63]).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('64x64 以外のサイズや空配列もそのままの形で複製する', () => {
    expect(cloneLayerPixels([])).toEqual([]);
    const small: LayerPixels = [[{ r: 1, g: 2, b: 3, a: 4 }, null], [null]];
    expect(cloneLayerPixels(small)).toEqual(small);
  });
});

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  it('英小文字と数字のみからなる 7 文字以下の文字列を返す', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(1));
    for (let i = 0; i < 1000; i++) {
      expect(generateId()).toMatch(/^[0-9a-z]{1,7}$/);
    }
  });

  it('通常の乱数値からは 7 文字の ID が得られる', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    expect(generateId()).toBe('4fzzzxj');
  });

  it('多数回呼び出しても ID が重複しない', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(2024));
    const ids = new Set<string>();
    const count = 10000;
    for (let i = 0; i < count; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(count);
  });

  it('乱数値が異なれば異なる ID になる', () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0.123456789).mockReturnValueOnce(0.999999);
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
    expect(b).toBe('zzzybj7');
  });
});
