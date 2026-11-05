"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import type { Catalog, Design } from "@/lib/schema";
import { designBounds } from "@/lib/tslot";
import { PartMesh } from "./PartMesh";

type Props = {
  design: Design;
  catalog: Catalog;
  selectedId: string | null;
  explodeAmount: number;
  offsets: Map<string, [number, number, number]>;
  showGrid: boolean;
  dark: boolean;
  onSelect: (id: string) => void;
};

function Rig({ center, radius }: { center: [number, number, number]; radius: number }) {
  return (
    <OrbitControls
      makeDefault
      target={center}
      enableDamping
      dampingFactor={0.08}
      minDistance={radius * 0.6}
      maxDistance={radius * 8}
      // 相机初始位置由 Canvas 的 camera 属性设置，这里只接管交互约束
      maxPolarAngle={Math.PI / 2 + 0.28}
    />
  );
}

export function Scene({
  design,
  catalog,
  selectedId,
  explodeAmount,
  offsets,
  showGrid,
  dark,
  onSelect,
}: Props) {
  const profileMap = useMemo(
    () => new Map(catalog.profiles.map((p) => [p.id, p])),
    [catalog],
  );
  const bounds = useMemo(() => designBounds(design.parts), [design]);

  // 相机按模型尺度推导：距离取半对角线 2.4 倍，俯角 10°，方位 42°。
  // 俯角必须小 —— 角度一大，台面就会把下面的框体和立柱全挡住，
  // 而铝型材框体才是这个项目的核心视觉。
  const camDist = bounds.radius * 2.4;
  const pitch = (10 * Math.PI) / 180;
  const yaw = (42 * Math.PI) / 180;
  const camera: [number, number, number] = [
    camDist * Math.cos(pitch) * Math.sin(yaw),
    bounds.center[1] + camDist * Math.sin(pitch),
    camDist * Math.cos(pitch) * Math.cos(yaw),
  ];

  const bg = dark ? "#18181b" : "#f4f4f5";
  const gridColor = dark ? "#3f3f46" : "#bfc4ca";

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // 关键：near/far 必须按 mm 尺度放大，three 默认 far=1000 会把整个模型裁掉
      camera={{
        position: camera,
        fov: 38,
        near: bounds.radius * 0.02,
        far: bounds.radius * 40,
      }}
      onPointerMissed={() => onSelect("")}
    >
      <color attach="background" args={[bg]} />

      <ambientLight intensity={dark ? 0.55 : 0.75} />
      <directionalLight
        position={[bounds.radius * 2, bounds.radius * 3.2, bounds.radius * 1.6]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-bounds.radius * 2}
        shadow-camera-right={bounds.radius * 2}
        shadow-camera-top={bounds.radius * 2}
        shadow-camera-bottom={-bounds.radius * 2}
        shadow-camera-near={1}
        shadow-camera-far={bounds.radius * 12}
      />
      <directionalLight
        position={[-bounds.radius * 2, bounds.radius * 1.4, -bounds.radius * 1.5]}
        intensity={0.7}
      />
      {/* 台面下方的补光：铝型材框体全藏在桌面阴影里，
          没有这盏向上的光，型材会糊成一片黑，看不到 T 槽。 */}
      <directionalLight
        position={[0, -bounds.radius * 1.6, bounds.radius * 1.2]}
        intensity={1.5}
        color="#eef2f7"
      />

      {/* 程序化环境贴图：不依赖任何远端 HDRI 文件。
          金属材质没有环境反射会发黑，这是必须的。 */}
      <Suspense fallback={null}>
        <Environment resolution={256}>
          <Lightformer
            intensity={2.8}
            position={[0, bounds.radius * 2, bounds.radius * 2]}
            scale={[bounds.radius * 4, bounds.radius * 1.5, 1]}
            color="#ffffff"
          />
          <Lightformer
            intensity={1.5}
            position={[-bounds.radius * 2.4, bounds.radius, 0]}
            scale={[bounds.radius * 1.6, bounds.radius * 1.6, 1]}
            rotation-y={Math.PI / 2}
            color="#ffffff"
          />
          <Lightformer
            intensity={1.1}
            position={[bounds.radius * 2.4, bounds.radius * 1.4, -bounds.radius]}
            scale={[bounds.radius * 1.6, bounds.radius * 1.6, 1]}
            rotation-y={-Math.PI / 2}
            color="#e8eef5"
          />
          <Lightformer
            intensity={0.6}
            position={[0, -bounds.radius, 0]}
            scale={[bounds.radius * 4, bounds.radius * 4, 1]}
            rotation-x={-Math.PI / 2}
            color="#cdd4dc"
          />
        </Environment>
      </Suspense>

      {design.parts.map((part) => (
        <PartMesh
          key={part.id}
          part={part}
          profile={part.profile ? profileMap.get(part.profile) : undefined}
          selected={selectedId === part.id}
          dimmed={selectedId !== null && selectedId !== part.id && explodeAmount === 0}
          explodeOffset={offsets.get(part.id) ?? [0, 0, 0]}
          onSelect={onSelect}
        />
      ))}

      {showGrid && (
        // 用 three 原生 gridHelper 而不是 drei 的 <Grid>：
        // <Grid> 会把 canvas 的缓冲区锁在 300×150，导致整个场景不可见。
        <gridHelper
          args={[bounds.radius * 8, (bounds.radius * 8) / 100, gridColor, gridColor]}
          position={[0, 0.5, 0]}
        />
      )}

      <ContactShadows
        position={[0, 1, 0]}
        opacity={0.32}
        scale={bounds.radius * 4}
        blur={2.4}
        far={bounds.radius * 2}
        resolution={1024}
        color="#000000"
      />

      <Rig center={bounds.center} radius={bounds.radius} />
    </Canvas>
  );
}
