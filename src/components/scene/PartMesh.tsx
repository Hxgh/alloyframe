"use client";

import { useEffect, useMemo } from "react";
import type { Part, Profile } from "@/lib/schema";
import { beamDims, materialLook } from "@/lib/materials";
import { partRotation, beamGeometry } from "@/lib/tslot";

type Props = {
  part: Part;
  profile?: Profile;
  selected: boolean;
  dimmed: boolean;
  dark: boolean;
  explodeOffset: [number, number, number];
  onSelect: (id: string) => void;
};

/**
 * 单个零件的渲染。
 *
 * 所有几何都在 mm 尺度下构建，与 design.json 完全一致 —— 不做单位缩放。
 * 材质按 `material` 字段的关键词匹配，未知材料回退到中性灰。
 */
export function PartMesh({ part, profile, selected, dimmed, dark, explodeOffset, onSelect }: Props) {
  const look = materialLook(part.material, dark);

  const geometry = useMemo(() => {
    if (part.kind === "beam" && profile) {
      const { length, sectionW, sectionH } = beamDims(part);
      return beamGeometry(profile, sectionW, sectionH, length);
    }
    return null;
  }, [part, profile]);

  // 外部创建的 BufferGeometry 不由 R3F 释放；替换或卸载时必须手动 dispose。
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const rotation = partRotation(part);

  const position: [number, number, number] = [
    part.position[0] + explodeOffset[0],
    part.position[1] + explodeOffset[1],
    part.position[2] + explodeOffset[2],
  ];

  const material = (
    <meshStandardMaterial
      color={selected ? dark ? "#60a5fa" : "#2563eb" : look.color}
      metalness={selected ? 0.2 : look.metalness}
      roughness={selected ? 0.45 : look.roughness}
      emissive={selected ? dark ? "#3b82f6" : "#1d4ed8" : "#000000"}
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
