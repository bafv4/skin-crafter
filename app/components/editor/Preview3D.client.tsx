import { useRef, useEffect, useMemo, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../stores/editorStore';
import { SKIN_WIDTH, SKIN_HEIGHT, type ModelType, type RGBA } from '../../types/editor';
import { DEFAULT_POSE, poseToRotation, type Pose, type PosePartKey } from '../../lib/pose';
import { canvasToBlob } from '../../lib/skinRenderer';

// Body parts that can be toggled individually in the 3D preview
export type BodyPartKey = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';

// Visibility of inner (layer 1) and outer (layer 2) meshes per body part
export type PartVisibility = Record<BodyPartKey, { inner: boolean; outer: boolean }>;

export const BODY_PART_KEYS: BodyPartKey[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];

export function createPartVisibility(visible: boolean): PartVisibility {
  const result = {} as PartVisibility;
  for (const key of BODY_PART_KEYS) {
    result[key] = { inner: visible, outer: visible };
  }
  return result;
}

export const DEFAULT_PART_VISIBILITY: PartVisibility = createPartVisibility(true);

// Helper to build texture data from composite
function buildTextureData(composite: RGBA[][]): Uint8Array {
  const data = new Uint8Array(SKIN_WIDTH * SKIN_HEIGHT * 4);

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      // Flip Y for texture coordinates
      const srcY = SKIN_HEIGHT - 1 - y;
      const pixel = composite[srcY][x];
      const i = (y * SKIN_WIDTH + x) * 4;

      data[i] = pixel.r;
      data[i + 1] = pixel.g;
      data[i + 2] = pixel.b;
      data[i + 3] = pixel.a;
    }
  }

  return data;
}

// Create texture from pixel data
// Updates texture data in-place when previewVersion changes to avoid GPU memory leaks
function useSkinTexture() {
  // Subscribe to previewVersion to control when texture updates
  const previewVersion = useEditorStore((state) => state.previewVersion);

  // Single texture instance, lazily initialized
  const textureRef = useRef<THREE.DataTexture | null>(null);
  if (!textureRef.current) {
    const state = useEditorStore.getState();
    const composite = state.getComposite();
    const data = buildTextureData(composite);

    const tex = new THREE.DataTexture(
      data,
      SKIN_WIDTH,
      SKIN_HEIGHT,
      THREE.RGBAFormat
    );
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    // Clamp to edge to prevent texture bleeding at seams
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    // ピクセルデータは sRGB。sRGB として扱えば（トーンマッピング無効の下で）デコード→再エンコードで
    // 2D キャンバスと同じ値が出力される
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    textureRef.current = tex;
  }

  // Update texture data in-place when previewVersion changes
  useEffect(() => {
    const tex = textureRef.current!;
    const state = useEditorStore.getState();
    const composite = state.getComposite();
    const newData = buildTextureData(composite);
    (tex.image.data as Uint8Array).set(newData);
    tex.needsUpdate = true;
    invalidate();
  }, [previewVersion]);

  // Dispose texture on unmount only
  useEffect(() => {
    return () => { textureRef.current?.dispose(); };
  }, []);

  return textureRef.current;
}

// UV mapping for Minecraft skin parts
// Based on skinview3d implementation (https://github.com/bs-community/skinview3d)
//
// Minecraft skin UV format: coordinates are (x, y, width, height) from top-left of texture
// Three.js BoxGeometry face order: +X (right), -X (left), +Y (top), -Y (bottom), +Z (front), -Z (back)
//
// When the character faces the camera (front facing +Z):
// - MC Right = character's right side (viewer's left) -> Three.js -X
// - MC Left = character's left side (viewer's right) -> Three.js +X
// - MC Front = facing viewer -> Three.js +Z
// - MC Back = facing away -> Three.js -Z
//
// UV の内側オフセット（テクセル単位）
const UV_INSET = 0.01;

// レイヤー2（外側）の拡大率
const LAYER2_SCALE = 1.1;

// 隣接パーツのレイヤー2同士が同一平面で重なると Z ファイティングで線やちらつきが出るため、
// パーツごとにごくわずかに異なる量だけ外側へ広げる（1px = 0.125 なので見た目には影響しない）
const LAYER2_EXTRA: Record<BodyPartKey, number> = {
  head: 0,
  rightLeg: 0,
  leftLeg: 0.004,
  body: 0.008,
  rightArm: 0.012,
  leftArm: 0.012,
};

// 胴体の下辺には両足の境目（x=0）に頂点がないため（T字接合）、辺に沿って微小な隙間が生じ
// 内部の面が点線状に見えることがある。足を胴体側へわずかに食い込ませて隙間を塞ぐ
const LEG_OVERLAP = 0.01;
const LEG_SIZE: [number, number, number] = [0.5, 1.5 + LEG_OVERLAP, 0.5];
const LEG_Y = -1.125 + LEG_OVERLAP / 2;

// 箱の各面に貼るスキン上の矩形 [x, y, 幅, 高さ]（ピクセル）
type UvRect = [number, number, number, number];
export type UvMap = Record<'front' | 'back' | 'top' | 'bottom' | 'right' | 'left', UvRect>;

export function createSkinGeometry(
  width: number,
  height: number,
  depth: number,
  uvMap: UvMap
) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uvAttribute = geometry.getAttribute('uv');

  // Helper to convert pixel coords to UV coords
  // Returns 4 vertices: bottom-left, bottom-right, top-right, top-left (CCW from bottom-left)
  // ClampToEdgeWrapping prevents texture bleeding, so we use exact pixel boundaries
  // UV をテクセル境界ちょうどにすると、面の端で浮動小数点誤差により隣のテクセル
  // （透明や別パーツの色）が拾われ、細い線が出る。わずかに内側へ寄せて防ぐ
  const toFaceUVs = (x: number, y: number, w: number, h: number): [number, number][] => {
    const u1 = (x + UV_INSET) / SKIN_WIDTH;
    const u2 = (x + w - UV_INSET) / SKIN_WIDTH;
    const v1 = 1 - (y + h - UV_INSET) / SKIN_HEIGHT; // bottom in UV
    const v2 = 1 - (y + UV_INSET) / SKIN_HEIGHT;     // top in UV
    return [
      [u1, v1], // 0: bottom-left
      [u2, v1], // 1: bottom-right
      [u2, v2], // 2: top-right
      [u1, v2], // 3: top-left
    ];
  };

  // Get base UVs for each MC face
  const right = toFaceUVs(...uvMap.right);
  const left = toFaceUVs(...uvMap.left);
  const top = toFaceUVs(...uvMap.top);
  const bottom = toFaceUVs(...uvMap.bottom);
  const front = toFaceUVs(...uvMap.front);
  const back = toFaceUVs(...uvMap.back);

  // Three.js BoxGeometry vertex order per face: bottom-left, bottom-right, top-left, top-right
  // We need to remap to match MC texture orientation
  // Reordering pattern from skinview3d: [3, 2, 0, 1] for most faces, [0, 1, 3, 2] for bottom

  // Three.js face order: +X, -X, +Y, -Y, +Z, -Z
  // Map: +X -> MC Left, -X -> MC Right, +Y -> MC Top, -Y -> MC Bottom, +Z -> MC Front, -Z -> MC Back
  const uvRight = [right[3], right[2], right[0], right[1]];
  const uvLeft = [left[3], left[2], left[0], left[1]];
  const uvTop = [top[3], top[2], top[0], top[1]];
  const uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]];
  const uvFront = [front[3], front[2], front[0], front[1]];
  const uvBack = [back[3], back[2], back[0], back[1]];

  // Apply UVs in Three.js face order: +X, -X, +Y, -Y, +Z, -Z
  // Which maps to: left, right, top, bottom, front, back
  const faceUVs = [uvLeft, uvRight, uvTop, uvBottom, uvFront, uvBack];

  for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
    const uvs = faceUVs[faceIndex];
    const baseIndex = faceIndex * 4;
    for (let i = 0; i < 4; i++) {
      uvAttribute.setXY(baseIndex + i, uvs[i][0], uvs[i][1]);
    }
  }

  uvAttribute.needsUpdate = true;
  return geometry;
}

// Body part component
function BodyPart({
  position,
  size,
  uvMap,
  texture,
  layer2UvMap,
  layer2Extra,
  showInner,
  showLayer2,
}: {
  position: [number, number, number];
  size: [number, number, number];
  uvMap: UvMap;
  texture: THREE.Texture;
  layer2UvMap?: UvMap;
  layer2Extra: number;
  showInner: boolean;
  showLayer2: boolean;
}) {
  const geometry = useMemo(
    () => createSkinGeometry(size[0], size[1], size[2], uvMap),
    [size, uvMap]
  );

  const layer2Geometry = useMemo(() => {
    if (!layer2UvMap) return null;
    return createSkinGeometry(
      size[0] * LAYER2_SCALE + layer2Extra,
      size[1] * LAYER2_SCALE + layer2Extra,
      size[2] * LAYER2_SCALE + layer2Extra,
      layer2UvMap
    );
  }, [size, layer2UvMap, layer2Extra]);

  // GPU memory: dispose old geometries when deps change or component unmounts
  useEffect(() => {
    return () => {
      geometry.dispose();
      layer2Geometry?.dispose();
    };
  }, [geometry, layer2Geometry]);

  return (
    <group position={position}>
      {/* 表示切り替えは visible で行い、メッシュ・マテリアルの再生成を避ける */}
      <mesh geometry={geometry} visible={showInner}>
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {layer2Geometry && (
        <mesh geometry={layer2Geometry} visible={showLayer2}>
          <meshBasicMaterial
            map={texture}
            transparent
            alphaTest={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

// 関節: pivot（モデル座標）を中心に子のパーツを回転させる。子の位置もモデル座標で指定する
function Joint({ pivot, rotation, children }: {
  pivot: [number, number, number];
  rotation: [number, number, number];
  children: ReactNode;
}) {
  return (
    <group position={pivot} rotation={rotation}>
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
    </group>
  );
}

// 頭・胴体の位置と大きさ（1 = 8px）。腕は胴体と同じ高さに並ぶ
const HEAD_Y = 1.595;
const HEAD_SIZE: [number, number, number] = [1, 1, 1];
const BODY_Y = 0.375;
const BODY_SIZE: [number, number, number] = [1, 1.5, 0.5];
// 胴体の上端・下端（首・腰の高さ）。腕の付け根は Minecraft と同じく上端から 2px 下
const BODY_TOP = BODY_Y + BODY_SIZE[1] / 2;
const BODY_BOTTOM = BODY_Y - BODY_SIZE[1] / 2;
const SHOULDER_Y = BODY_TOP - 2 / 8;

const HEAD_UV: UvMap = {
  front: [8, 8, 8, 8],
  back: [24, 8, 8, 8],
  top: [8, 0, 8, 8],
  bottom: [16, 0, 8, 8],
  right: [0, 8, 8, 8],
  left: [16, 8, 8, 8],
};

const HEAD_LAYER2_UV: UvMap = {
  front: [40, 8, 8, 8],
  back: [56, 8, 8, 8],
  top: [40, 0, 8, 8],
  bottom: [48, 0, 8, 8],
  right: [32, 8, 8, 8],
  left: [48, 8, 8, 8],
};

const BODY_UV: UvMap = {
  front: [20, 20, 8, 12],
  back: [32, 20, 8, 12],
  top: [20, 16, 8, 4],
  bottom: [28, 16, 8, 4],
  right: [16, 20, 4, 12],
  left: [28, 20, 4, 12],
};

const BODY_LAYER2_UV: UvMap = {
  front: [20, 36, 8, 12],
  back: [32, 36, 8, 12],
  top: [20, 32, 8, 4],
  bottom: [28, 32, 8, 4],
  right: [16, 36, 4, 12],
  left: [28, 36, 4, 12],
};

const RIGHT_LEG_UV: UvMap = {
  front: [4, 20, 4, 12],
  back: [12, 20, 4, 12],
  top: [4, 16, 4, 4],
  bottom: [8, 16, 4, 4],
  right: [0, 20, 4, 12],
  left: [8, 20, 4, 12],
};

const RIGHT_LEG_LAYER2_UV: UvMap = {
  front: [4, 36, 4, 12],
  back: [12, 36, 4, 12],
  top: [4, 32, 4, 4],
  bottom: [8, 32, 4, 4],
  right: [0, 36, 4, 12],
  left: [8, 36, 4, 12],
};

const LEFT_LEG_UV: UvMap = {
  front: [20, 52, 4, 12],
  back: [28, 52, 4, 12],
  top: [20, 48, 4, 4],
  bottom: [24, 48, 4, 4],
  right: [16, 52, 4, 12],
  left: [24, 52, 4, 12],
};

const LEFT_LEG_LAYER2_UV: UvMap = {
  front: [4, 52, 4, 12],
  back: [12, 52, 4, 12],
  top: [4, 48, 4, 4],
  bottom: [8, 48, 4, 4],
  right: [0, 52, 4, 12],
  left: [8, 52, 4, 12],
};


// 腕の UV（幅 w = 3 または 4px）
function armUvMaps(w: number): Record<'rightArmUvMap' | 'rightArmLayer2UvMap' | 'leftArmUvMap' | 'leftArmLayer2UvMap', UvMap> {
  const arm = (x: number, y: number): UvMap => ({
    front: [x + 4, y + 4, w, 12],
    back: [x + 4 + w + 4, y + 4, w, 12],
    top: [x + 4, y, w, 4],
    bottom: [x + 4 + w, y, w, 4],
    right: [x, y + 4, 4, 12],
    left: [x + 4 + w, y + 4, 4, 12],
  });
  return {
    rightArmUvMap: arm(40, 16),
    rightArmLayer2UvMap: arm(40, 32),
    leftArmUvMap: arm(32, 48),
    leftArmLayer2UvMap: arm(48, 48),
  };
}

// Minecraft character model
function MinecraftCharacter({ modelType, autoRotate, partVisibility, pose }: {
  modelType: ModelType;
  autoRotate: boolean;
  partVisibility: PartVisibility;
  pose: Pose;
}) {
  const texture = useSkinTexture();
  const showLayer2 = useEditorStore((state) => state.showLayer2);
  const groupRef = useRef<THREE.Group>(null);

  // Re-render on demand when part visibility changes
  useEffect(() => {
    invalidate();
  }, [partVisibility, showLayer2, pose]);

  const rotationOf = (part: PosePartKey) => poseToRotation(part, pose[part]);

  const partProps = (key: BodyPartKey) => ({
    layer2Extra: LAYER2_EXTRA[key],
    showInner: partVisibility[key].inner,
    showLayer2: showLayer2 && partVisibility[key].outer,
  });

  // Rotate slowly when autoRotate is enabled
  // When not rotating, useFrame still runs but does nothing (frameloop=demand handles this)
  useFrame((_, delta) => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y += delta * 0.3;
      // Request next frame for continuous animation
      invalidate();
    }
  });

  const armWidth = modelType === 'alex' ? 0.375 : 0.5;
  const armPixelWidth = modelType === 'alex' ? 3 : 4;

  // 腕の UV と大きさ（Alex は幅 3px、Steve は 4px）。描画のたびに作り直すとジオメトリも作り直されるのでメモ化する
  const { rightArmUvMap, rightArmLayer2UvMap, leftArmUvMap, leftArmLayer2UvMap } = useMemo(
    () => armUvMaps(armPixelWidth),
    [armPixelWidth]
  );
  const armSize = useMemo<[number, number, number]>(() => [armWidth, BODY_SIZE[1], BODY_SIZE[2]], [armWidth]);

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Head */}
      <Joint pivot={[0, BODY_TOP, 0]} rotation={rotationOf('head')}>
      <BodyPart
        position={[0, HEAD_Y, 0]}
        size={HEAD_SIZE}
        uvMap={HEAD_UV}
        layer2UvMap={HEAD_LAYER2_UV}
        texture={texture}
        {...partProps('head')}
      />
      </Joint>

      {/* Body */}
      <BodyPart
        position={[0, BODY_Y, 0]}
        size={BODY_SIZE}
        uvMap={BODY_UV}
        layer2UvMap={BODY_LAYER2_UV}
        texture={texture}
        {...partProps('body')}
      />

      {/* Right Arm */}
      <Joint pivot={[-0.5 - armWidth / 2, SHOULDER_Y, 0]} rotation={rotationOf('rightArm')}>
        <BodyPart
          position={[-0.5 - armWidth / 2, BODY_Y, 0]}
          size={armSize}
          uvMap={rightArmUvMap}
          layer2UvMap={rightArmLayer2UvMap}
          texture={texture}
          {...partProps('rightArm')}
        />
      </Joint>

      {/* Left Arm */}
      <Joint pivot={[0.5 + armWidth / 2, SHOULDER_Y, 0]} rotation={rotationOf('leftArm')}>
        <BodyPart
          position={[0.5 + armWidth / 2, BODY_Y, 0]}
          size={armSize}
          uvMap={leftArmUvMap}
          layer2UvMap={leftArmLayer2UvMap}
          texture={texture}
          {...partProps('leftArm')}
        />
      </Joint>

      {/* Right Leg */}
      <Joint pivot={[-0.25, BODY_BOTTOM, 0]} rotation={rotationOf('rightLeg')}>
      <BodyPart
        position={[-0.25, LEG_Y, 0]}
        size={LEG_SIZE}
        uvMap={RIGHT_LEG_UV}
        layer2UvMap={RIGHT_LEG_LAYER2_UV}
        texture={texture}
        {...partProps('rightLeg')}
      />
      </Joint>

      {/* Left Leg */}
      <Joint pivot={[0.25, BODY_BOTTOM, 0]} rotation={rotationOf('leftLeg')}>
      <BodyPart
        position={[0.25, LEG_Y, 0]}
        size={LEG_SIZE}
        uvMap={LEFT_LEG_UV}
        layer2UvMap={LEFT_LEG_LAYER2_UV}
        texture={texture}
        {...partProps('leftLeg')}
      />
      </Joint>
    </group>
  );
}

// Scene setup
function Scene({ autoRotate, zoom, onZoomChange, resetKey, partVisibility, pose }: {
  autoRotate: boolean;
  partVisibility: PartVisibility;
  pose: Pose;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  resetKey: number;
}) {
  const modelType = useEditorStore((state) => state.modelType);
  const controlsRef = useRef<any>(null);
  const lastZoomRef = useRef(zoom);

  // Reset camera when resetKey changes
  useEffect(() => {
    if (controlsRef.current && resetKey > 0) {
      controlsRef.current.reset();
    }
  }, [resetKey]);

  // Update camera distance when zoom changes from buttons
  useEffect(() => {
    if (!controlsRef.current) return;

    // Only apply if zoom was changed externally (not from wheel)
    if (Math.abs(lastZoomRef.current - zoom) > 0.01) {
      const controls = controlsRef.current;
      const camera = controls.object;
      if (camera) {
        // Calculate new distance based on zoom (zoom 1 = distance 4)
        const targetDistance = 4 / zoom;
        const currentDistance = camera.position.length();
        const scale = targetDistance / currentDistance;

        camera.position.multiplyScalar(scale);
        controls.update();
      }
      lastZoomRef.current = zoom;
    }
  }, [zoom]);

  // Handle wheel zoom and sync with parent
  // Also trigger re-render on controls change for on-demand frameloop
  useEffect(() => {
    if (!controlsRef.current) return;

    const controls = controlsRef.current;
    const handleChange = () => {
      // Request re-render when user interacts with controls
      invalidate();
      if (controls.object && onZoomChange) {
        const distance = controls.object.position.length();
        // Convert distance to zoom (inverse relationship)
        const newZoom = Math.max(0.5, Math.min(2, 4 / distance));
        lastZoomRef.current = newZoom;
        onZoomChange(newZoom);
      }
    };

    controls.addEventListener('change', handleChange);
    return () => controls.removeEventListener('change', handleChange);
  }, [onZoomChange]);

  return (
    <>
      <MinecraftCharacter modelType={modelType} autoRotate={autoRotate} partVisibility={partVisibility} pose={pose} />
      <OrbitControls
        ref={controlsRef}
        enablePan={true}
        minDistance={2}
        maxDistance={8}
        target={[0, 0.5, 0]}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
        panSpeed={0.5}
      />
    </>
  );
}

// Component to trigger initial render and handle texture updates
function RenderController({ autoRotate }: { autoRotate: boolean }) {
  const previewVersion = useEditorStore((state) => state.previewVersion);

  // Trigger re-render when texture updates
  useEffect(() => {
    invalidate();
  }, [previewVersion]);

  // Start animation loop when autoRotate is enabled
  useEffect(() => {
    if (autoRotate) {
      invalidate();
    }
  }, [autoRotate]);

  return null;
}

// 3D プレビューを PNG 画像にする関数（背景は透明）
export type Capture3D = () => Promise<Blob>;

// 書き出す画像の長辺の最小ピクセル数（表示が小さくても十分な解像度にする）と、描画倍率の上限
const CAPTURE_MIN_LONG_SIDE = 1024;
const CAPTURE_MAX_PIXEL_RATIO = 4;

export function captureScale(width: number, height: number, currentRatio: number): number {
  const needed = CAPTURE_MIN_LONG_SIDE / Math.max(width, height, 1);
  return Math.min(CAPTURE_MAX_PIXEL_RATIO, Math.max(currentRatio, needed));
}

// Canvas の中から、いまの視点・ポーズのまま書き出す関数を captureRef に渡す
function CaptureBridge({ captureRef }: { captureRef: MutableRefObject<Capture3D | null> }) {
  const { gl, scene, camera, size } = useThree();

  useEffect(() => {
    captureRef.current = () => {
      const previousRatio = gl.getPixelRatio();
      gl.setPixelRatio(captureScale(size.width, size.height, previousRatio));
      gl.render(scene, camera);
      // toBlob は呼び出した時点の描画内容を写し取るので、描画直後に（倍率を戻す前に）呼ぶ
      const blob = canvasToBlob(gl.domElement);
      gl.setPixelRatio(previousRatio);
      invalidate();
      return blob;
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, scene, camera, size, captureRef]);

  return null;
}

export function Preview3DCanvas({
  autoRotate = true,
  zoom = 1,
  onZoomChange,
  resetKey = 0,
  partVisibility,
  pose = DEFAULT_POSE,
  captureRef,
}: {
  autoRotate?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  resetKey?: number;
  partVisibility: PartVisibility;
  pose?: Pose;
  captureRef?: MutableRefObject<Capture3D | null>;
}) {
  return (
    <Canvas
      camera={{ position: [3 / zoom, 2 / zoom, 3 / zoom], fov: 45 }}
      frameloop="demand"
      // 2Dキャンバスと同じ色で表示するため、R3F 既定のトーンマッピング（ACES）を無効化する
      flat
    >
      <RenderController autoRotate={autoRotate} />
      {captureRef && <CaptureBridge captureRef={captureRef} />}
      <Scene autoRotate={autoRotate} zoom={zoom} onZoomChange={onZoomChange} resetKey={resetKey} partVisibility={partVisibility} pose={pose} />
    </Canvas>
  );
}
