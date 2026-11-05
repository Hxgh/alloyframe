"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { Part, Profile } from "@/lib/schema";
import { beamDims, longAxis, materialLook } from "@/lib/materials";
import { axisRotation, beamGeometry } from "@/lib/tslot";

type Props = {
  part: Part;
  profile?: Profile;
  selected: boolean;
  dimmed: boolean;
  explodeOffset: [number, number, number];
  onSelect: (id: string) => void;
};

/**
 * 单个零件的渲染。
 *
 * 所有几何都在 mm 尺度下构建，与 design.json 完全一致 —— 不做单位缩放。
 * 材质按 `material` 字段的关键词匹配，未知材料回退到中性灰。
 */
export function PartMesh({ part, profile, selected, dimmed, explodeOffset, onSelect }: Props) {
  const look = materialLook(part.material);

  const geometry = useMemo(() => {
    if (part.kind === "beam" && profile) {
      const { length, sectionW, sectionH } = beamDims(part);
      return beamGeometry(profile, sectionW, sectionH, length);
    }
    return null;
  }, [part, profile]);

  const rotation = useMemo<[number, number, number]>(() => {
    if (part.kind === "beam" && profile) {
      const base = axisRotation(longAxis(part));
      const extra = part.rotation.map((d) => (d * Math.PI) / 180);
      return [base[0] + extra[0], base[1] + extra[1], base[2] + extra[2]];
    }
    return part.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number];
  }, [part, profile]);

  const position: [number, number, number] = [
    part.position[0] + explodeOffset[0],
    part.position[1] + explodeOffset[1],
    part.position[2] + explodeOffset[2],
  ];

  const material = (
    <meshStandardMaterial
      color={selected ? "#3b82f6" : look.color}
      metalness={selected ? 0.2 : look.metalness}
      roughness={selected ? 0.45 : look.roughness}
      emissive={selected ? "#1d4ed8" : "#000000"}
      emissiveIntensity={selected ? 0.25 : 0}
      transparent={dimmed}
      opacity={dimmed ? 0.18 : 1}
    />
  );

  if (geometry) {
    return (
      <mesh
        geometry={geometry}
        position={position}
        rotation={rotation}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect(part.id);
        }}
      >
        {material}
      </mesh>
    );
  }

  // 非型材：直接用包围盒
  return (
    <mesh
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect(part.id);
      }}
    >
      <boxGeometry args={part.size as [number, number, number]} />
      {material}
    </mesh>
  );
}
