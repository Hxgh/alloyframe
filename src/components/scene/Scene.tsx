"use client";

import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, GizmoHelper, GizmoViewport, Lightformer, OrbitControls } from "@react-three/drei";
import { PCFShadowMap, PerspectiveCamera } from "three";
import type { Catalog, Design } from "@/lib/schema";
import { designBounds } from "@/lib/tslot";
import { explodeOffsets } from "@/lib/explode";
import { applyViewFrame, combineBounds, frameRequest, type SceneBounds, type Vec3, type ViewRequest, type ViewState } from "@/lib/scene-fit";
import { createTapGesture, isSelectionClick } from "@/lib/tap-gesture";
import { sceneControls } from "@/lib/scene-controls";
import { PartMesh } from "./PartMesh";

type Props = {
  design: Design;
  catalog: Catalog;
  selectedId: string | null;
  explodeAmount: number;
  offsets: Map<string, [number, number, number]>;
  viewRequest: ViewRequest;
  showGrid: boolean;
  dark: boolean;
  onSelect: (id: string) => void;
};

const mobileQuery = "(max-width: 1023px), (pointer: coarse)";
function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function Rig({ bounds, viewRequest }: { bounds: SceneBounds; viewRequest: ViewRequest }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const previous = useRef<ViewState | null>(null);
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);

  useEffect(() => {
    const { camera, invalidate } = get();
    if (!(camera instanceof PerspectiveCamera) || !controls.current || size.width <= 0 || size.height <= 0) return;
    const last = previous.current;
    const view = last ? {
      position: camera.position.toArray() as Vec3,
      target: controls.current.target.toArray() as Vec3,
    } : undefined;
    const frame = frameRequest(bounds, camera.fov, size.width / size.height, viewRequest, view, last ?? undefined);
    applyViewFrame(camera, controls.current, frame);
    previous.current = { bounds, requestId: viewRequest.id, distance: frame.fitDistance };
    invalidate();
    // 尺寸更新会重置 WebGL 缓冲，等画布完成 resize 后再补一帧。
    const repaint = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(repaint);
  }, [bounds, get, size.width, size.height, viewRequest]);

  return <OrbitControls ref={controls} makeDefault {...sceneControls} />;
}

export function Scene({ design, catalog, selectedId, explodeAmount, offsets, viewRequest, showGrid, dark, onSelect }: Props) {
  const profileMap = useMemo(() => new Map(catalog.profiles.map((p) => [p.id, p])), [catalog]);
  const bounds = useMemo(() => {
    const assembled = designBounds(design.parts);
    const exploded = designBounds(design.parts, explodeOffsets(design.parts, 1));
    return combineBounds(assembled, exploded);
  }, [design.parts]);
  const gesture = useMemo(() => createTapGesture(), []);
  useEffect(() => {
    // OrbitControls 允许拖出画布继续操作；结束清理也必须覆盖 document。
    document.addEventListener("pointermove", gesture.move, true);
    document.addEventListener("pointerup", gesture.up, true);
    document.addEventListener("pointercancel", gesture.cancel, true);
    window.addEventListener("blur", gesture.reset);
    return () => {
      document.removeEventListener("pointermove", gesture.move, true);
      document.removeEventListener("pointerup", gesture.up, true);
      document.removeEventListener("pointercancel", gesture.cancel, true);
      window.removeEventListener("blur", gesture.reset);
    };
  }, [gesture]);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(mobileQuery).matches, () => false);
  const shadowSize = mobile ? 1024 : 2048;
  const gridColor = dark ? "#3f3f46" : "#bfc4ca";

  function selectIfTap(id: string) {
    if (gesture.isTap()) onSelect(id);
  }

  return (
    <div
      className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
      onPointerDownCapture={(event) => gesture.down(event)}
      onPointerMoveCapture={(event) => gesture.move(event)}
      onPointerUpCapture={(event) => gesture.up(event)}
      onPointerCancelCapture={(event) => gesture.cancel(event)}
    >
      <Canvas
        frameloop="demand"
        shadows={{ type: PCFShadowMap }}
        dpr={[1, mobile ? 1.5 : 2]}
        camera={{ fov: 38, near: bounds.radius * 0.02, far: bounds.radius * 40 }}
        onPointerMissed={(event) => { if (isSelectionClick(event)) selectIfTap(""); }}
      >
        <color attach="background" args={[dark ? "#18181b" : "#f4f4f5"]} />
        <ambientLight intensity={dark ? 0.55 : 0.75} />
        <directionalLight
          position={[bounds.radius * 2, bounds.radius * 3.2, bounds.radius * 1.6]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[shadowSize, shadowSize]}
          shadow-camera-left={-bounds.radius * 2}
          shadow-camera-right={bounds.radius * 2}
          shadow-camera-top={bounds.radius * 2}
          shadow-camera-bottom={-bounds.radius * 2}
          shadow-camera-near={1}
          shadow-camera-far={bounds.radius * 12}
          shadow-normalBias={2}
        />
        <directionalLight position={[-bounds.radius * 2, bounds.radius * 1.4, -bounds.radius * 1.5]} intensity={0.7} />
        <directionalLight position={[0, -bounds.radius * 1.6, bounds.radius * 1.2]} intensity={1.5} color="#eef2f7" />

        {/* mm 尺度下，环境捕获相机也需要显式 far，不能只调主相机。 */}
        <Suspense fallback={null}>
          <Environment resolution={mobile ? 128 : 256} near={1} far={bounds.radius * 12}>
            <Lightformer intensity={2.8} position={[0, bounds.radius * 2, bounds.radius * 2]} scale={[bounds.radius * 4, bounds.radius * 1.5, 1]} color="#ffffff" />
            <Lightformer intensity={1.5} position={[-bounds.radius * 2.4, bounds.radius, 0]} scale={[bounds.radius * 1.6, bounds.radius * 1.6, 1]} rotation-y={Math.PI / 2} color="#ffffff" />
            <Lightformer intensity={1.1} position={[bounds.radius * 2.4, bounds.radius * 1.4, -bounds.radius]} scale={[bounds.radius * 1.6, bounds.radius * 1.6, 1]} rotation-y={-Math.PI / 2} color="#e8eef5" />
            <Lightformer intensity={0.6} position={[0, -bounds.radius, 0]} scale={[bounds.radius * 4, bounds.radius * 4, 1]} rotation-x={-Math.PI / 2} color="#cdd4dc" />
          </Environment>
        </Suspense>

        {design.parts.map((part) => (
          <PartMesh
            key={part.id}
            part={part}
            profile={part.profile ? profileMap.get(part.profile) : undefined}
            selected={selectedId === part.id}
            dimmed={selectedId !== null && selectedId !== part.id && explodeAmount === 0}
            dark={dark}
            explodeOffset={offsets.get(part.id) ?? [0, 0, 0]}
            onSelect={selectIfTap}
          />
        ))}

        {showGrid && <gridHelper args={[bounds.radius * 8, 80, gridColor, gridColor]} position={[0, 0.5, 0]} />}
        {/* 共用主光源阴影；不再叠加持续更新的 ContactShadows 模糊 pass。 */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
          <planeGeometry args={[bounds.radius * 8, bounds.radius * 8]} />
          <shadowMaterial transparent opacity={0.18} depthWrite={false} />
        </mesh>
        <Rig bounds={bounds} viewRequest={viewRequest} />
        <GizmoHelper alignment="top-right" margin={[64, 64]}>
          <GizmoViewport disabled hideNegativeAxes labels={["+X", "+Y", "+Z"]}
            axisColors={dark ? ["#fb7185", "#4ade80", "#60a5fa"] : ["#e11d48", "#16a34a", "#2563eb"]}
            labelColor={dark ? "#18181b" : "#ffffff"} />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
