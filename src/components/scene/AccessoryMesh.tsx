"use client";

import { useEffect, useMemo } from "react";
import { MathUtils } from "three";
import type { ResolvedAccessoryInstance } from "@/lib/accessory-connections";
import { angleBracketGeometries } from "@/lib/accessory-geometry";
import type { Vec3 } from "@/lib/scene-fit";

type Props = {
  item: ResolvedAccessoryInstance;
  selectedId: string | null;
  dark: boolean;
  onSelect: (id: string) => void;
};

export function AccessoryMesh({ item, selectedId, dark, onSelect }: Props) {
  const geometries = useMemo(() => angleBracketGeometries(item.visual), [item.visual]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  const selected = item.instance.partIds.includes(selectedId ?? "");
  const rotation = item.rotation.map(MathUtils.degToRad) as Vec3;
  return (
    <group position={item.position} rotation={rotation} onClick={(event) => { event.stopPropagation(); onSelect(item.instance.anchorPartId); }}>
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial color={selected ? "#60a5fa" : dark ? "#b1bdc9" : "#8e9aa8"} metalness={0.65} roughness={0.42} />
        </mesh>
      ))}
    </group>
  );
}
