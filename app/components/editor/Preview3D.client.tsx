import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, invalidate } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../stores/editorStore';
import { SKIN_WIDTH, SKIN_HEIGHT, type ModelType, type RGBA } from '../../types/editor';

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
// Recreates texture when previewVersion changes
function useSkinTexture() {
  // Subscribe to previewVersion to control when texture updates
  const previewVersion = useEditorStore((state) => state.previewVersion);

  // Create new texture whenever previewVersion changes
  const texture = useMemo(() => {
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
    // Use NoColorSpace to prevent gamma correction - display colors exactly as in 2D canvas
    // The pixel data is already in sRGB, and we want to display it without any transformation
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;

    return tex;
  }, [previewVersion]);

  return texture;
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
function createSkinGeometry(
  width: number,
  height: number,
  depth: number,
  uvMap: {
    front: [number, number, number, number];
    back: [number, number, number, number];
    top: [number, number, number, number];
    bottom: [number, number, number, number];
    right: [number, number, number, number];
    left: [number, number, number, number];
  }
) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uvAttribute = geometry.getAttribute('uv');

  // Helper to convert pixel coords to UV coords
  // Returns 4 vertices: bottom-left, bottom-right, top-right, top-left (CCW from bottom-left)
  // ClampToEdgeWrapping prevents texture bleeding, so we use exact pixel boundaries
  const toFaceUVs = (x: number, y: number, w: number, h: number): [number, number][] => {
    const u1 = x / SKIN_WIDTH;
    const u2 = (x + w) / SKIN_WIDTH;
    const v1 = 1 - (y + h) / SKIN_HEIGHT; // bottom in UV
    const v2 = 1 - y / SKIN_HEIGHT;       // top in UV
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
  showLayer2,
}: {
  position: [number, number, number];
  size: [number, number, number];
  uvMap: {
    front: [number, number, number, number];
    back: [number, number, number, number];
    top: [number, number, number, number];
    bottom: [number, number, number, number];
    right: [number, number, number, number];
    left: [number, number, number, number];
  };
  texture: THREE.Texture;
  layer2UvMap?: typeof uvMap;
  showLayer2?: boolean;
}) {
  const geometry = useMemo(
    () => createSkinGeometry(size[0], size[1], size[2], uvMap),
    [size, uvMap]
  );

  const layer2Geometry = useMemo(() => {
    if (!layer2UvMap) return null;
    const scale = 1.1;
    return createSkinGeometry(
      size[0] * scale,
      size[1] * scale,
      size[2] * scale,
      layer2UvMap
    );
  }, [size, layer2UvMap]);

  return (
    <group position={position}>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {showLayer2 && layer2Geometry && (
        <mesh geometry={layer2Geometry}>
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

// Minecraft character model
function MinecraftCharacter({ modelType, autoRotate }: { modelType: ModelType; autoRotate: boolean }) {
  const texture = useSkinTexture();
  const showLayer2 = useEditorStore((state) => state.showLayer2);
  const groupRef = useRef<THREE.Group>(null);

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

  // Right arm UV maps (Alex: 3px wide, Steve: 4px wide)
  const rightArmUvMap = {
    front: [44, 20, armPixelWidth, 12] as [number, number, number, number],
    back: [44 + armPixelWidth + 4, 20, armPixelWidth, 12] as [number, number, number, number],
    top: [44, 16, armPixelWidth, 4] as [number, number, number, number],
    bottom: [44 + armPixelWidth, 16, armPixelWidth, 4] as [number, number, number, number],
    right: [40, 20, 4, 12] as [number, number, number, number],
    left: [44 + armPixelWidth, 20, 4, 12] as [number, number, number, number],
  };
  const rightArmLayer2UvMap = {
    front: [44, 36, armPixelWidth, 12] as [number, number, number, number],
    back: [44 + armPixelWidth + 4, 36, armPixelWidth, 12] as [number, number, number, number],
    top: [44, 32, armPixelWidth, 4] as [number, number, number, number],
    bottom: [44 + armPixelWidth, 32, armPixelWidth, 4] as [number, number, number, number],
    right: [40, 36, 4, 12] as [number, number, number, number],
    left: [44 + armPixelWidth, 36, 4, 12] as [number, number, number, number],
  };

  // Left arm UV maps (Alex: 3px wide, Steve: 4px wide)
  const leftArmUvMap = {
    front: [36, 52, armPixelWidth, 12] as [number, number, number, number],
    back: [36 + armPixelWidth + 4, 52, armPixelWidth, 12] as [number, number, number, number],
    top: [36, 48, armPixelWidth, 4] as [number, number, number, number],
    bottom: [36 + armPixelWidth, 48, armPixelWidth, 4] as [number, number, number, number],
    right: [32, 52, 4, 12] as [number, number, number, number],
    left: [36 + armPixelWidth, 52, 4, 12] as [number, number, number, number],
  };
  const leftArmLayer2UvMap = {
    front: [52, 52, armPixelWidth, 12] as [number, number, number, number],
    back: [52 + armPixelWidth + 4, 52, armPixelWidth, 12] as [number, number, number, number],
    top: [52, 48, armPixelWidth, 4] as [number, number, number, number],
    bottom: [52 + armPixelWidth, 48, armPixelWidth, 4] as [number, number, number, number],
    right: [48, 52, 4, 12] as [number, number, number, number],
    left: [52 + armPixelWidth, 52, 4, 12] as [number, number, number, number],
  };

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Head */}
      <BodyPart
        position={[0, 1.595, 0]}
        size={[1, 1, 1]}
        uvMap={{
          front: [8, 8, 8, 8],
          back: [24, 8, 8, 8],
          top: [8, 0, 8, 8],
          bottom: [16, 0, 8, 8],
          right: [0, 8, 8, 8],
          left: [16, 8, 8, 8],
        }}
        layer2UvMap={{
          front: [40, 8, 8, 8],
          back: [56, 8, 8, 8],
          top: [40, 0, 8, 8],
          bottom: [48, 0, 8, 8],
          right: [32, 8, 8, 8],
          left: [48, 8, 8, 8],
        }}
        texture={texture}
        showLayer2={showLayer2}
      />

      {/* Body */}
      <BodyPart
        position={[0, 0.375, 0]}
        size={[1, 1.5, 0.5]}
        uvMap={{
          front: [20, 20, 8, 12],
          back: [32, 20, 8, 12],
          top: [20, 16, 8, 4],
          bottom: [28, 16, 8, 4],
          right: [16, 20, 4, 12],
          left: [28, 20, 4, 12],
        }}
        layer2UvMap={{
          front: [20, 36, 8, 12],
          back: [32, 36, 8, 12],
          top: [20, 32, 8, 4],
          bottom: [28, 32, 8, 4],
          right: [16, 36, 4, 12],
          left: [28, 36, 4, 12],
        }}
        texture={texture}
        showLayer2={showLayer2}
      />

      {/* Right Arm */}
      <BodyPart
        position={[-0.5 - armWidth / 2, 0.375, 0]}
        size={[armWidth, 1.5, 0.5]}
        uvMap={rightArmUvMap}
        layer2UvMap={rightArmLayer2UvMap}
        texture={texture}
        showLayer2={showLayer2}
      />

      {/* Left Arm */}
      <BodyPart
        position={[0.5 + armWidth / 2, 0.375, 0]}
        size={[armWidth, 1.5, 0.5]}
        uvMap={leftArmUvMap}
        layer2UvMap={leftArmLayer2UvMap}
        texture={texture}
        showLayer2={showLayer2}
      />

      {/* Right Leg */}
      <BodyPart
        position={[-0.25, -1.125, 0]}
        size={[0.5, 1.5, 0.5]}
        uvMap={{
          front: [4, 20, 4, 12],
          back: [12, 20, 4, 12],
          top: [4, 16, 4, 4],
          bottom: [8, 16, 4, 4],
          right: [0, 20, 4, 12],
          left: [8, 20, 4, 12],
        }}
        layer2UvMap={{
          front: [4, 36, 4, 12],
          back: [12, 36, 4, 12],
          top: [4, 32, 4, 4],
          bottom: [8, 32, 4, 4],
          right: [0, 36, 4, 12],
          left: [8, 36, 4, 12],
        }}
        texture={texture}
        showLayer2={showLayer2}
      />

      {/* Left Leg */}
      <BodyPart
        position={[0.25, -1.125, 0]}
        size={[0.5, 1.5, 0.5]}
        uvMap={{
          front: [20, 52, 4, 12],
          back: [28, 52, 4, 12],
          top: [20, 48, 4, 4],
          bottom: [24, 48, 4, 4],
          right: [16, 52, 4, 12],
          left: [24, 52, 4, 12],
        }}
        layer2UvMap={{
          front: [4, 52, 4, 12],
          back: [12, 52, 4, 12],
          top: [4, 48, 4, 4],
          bottom: [8, 48, 4, 4],
          right: [0, 52, 4, 12],
          left: [8, 52, 4, 12],
        }}
        texture={texture}
        showLayer2={showLayer2}
      />
    </group>
  );
}

// Scene setup
function Scene({ autoRotate, zoom, onZoomChange, resetKey }: {
  autoRotate: boolean;
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
      <MinecraftCharacter modelType={modelType} autoRotate={autoRotate} />
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

export function Preview3DCanvas({
  autoRotate = true,
  zoom = 1,
  onZoomChange,
  resetKey = 0
}: {
  autoRotate?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  resetKey?: number;
}) {
  return (
    <Canvas
      camera={{ position: [3 / zoom, 2 / zoom, 3 / zoom], fov: 45 }}
      key={resetKey}
      frameloop="demand"
    >
      <RenderController autoRotate={autoRotate} />
      <Scene autoRotate={autoRotate} zoom={zoom} onZoomChange={onZoomChange} resetKey={resetKey} />
    </Canvas>
  );
}
