"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Part } from "@/lib/schema";
import { buildDimensionGuides, type DimensionGuide } from "@/lib/scene-dimensions";
import type { Vec3 } from "@/lib/scene-fit";

type Props = {
  parts: Part[];
  selectedId: string | null;
  offsets: ReadonlyMap<string, Vec3>;
  radius: number;
  dark: boolean;
};

function guideColor(guide: DimensionGuide, dark: boolean): string {
  if (guide.highlighted) return dark ? "#fbbf24" : "#d97706";
  if (guide.axis === "x") return dark ? "#fda4af" : "#be123c";
  if (guide.axis === "y") return dark ? "#86efac" : "#15803d";
  if (guide.axis === "z") return dark ? "#93c5fd" : "#1d4ed8";
  return dark ? "#d4d4d8" : "#52525b";
}

function createBadgeTexture(text: string, borderColor: string, dark: boolean): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const scale = 2;
  const fontSize = 14 * scale;
  const padX = 10 * scale;
  const padY = 6 * scale;
  const lines = text.split("\n");
  const lineHeight = fontSize * 1.25;
  const ctx = canvas.getContext("2d");
  const font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

  let textWidth = Math.max(...lines.map((line) => line.length * fontSize * 0.62));
  if (ctx) {
    ctx.font = font;
    textWidth = Math.ceil(Math.max(...lines.map((line) => ctx.measureText(line).width)));
  }
  const width = Math.max(Math.ceil(textWidth + padX * 2), 64);
  const height = Math.ceil(lines.length * lineHeight + padY * 2);
  canvas.width = width;
  canvas.height = height;

  if (ctx) {
    const r = 6 * scale;
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.roundRect(scale, scale, width - scale * 2, height - scale * 2, r);
    ctx.fillStyle = dark ? "rgba(24, 24, 27, 0.9)" : "rgba(255, 255, 255, 0.92)";
    ctx.fill();
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = borderColor;
    ctx.stroke();

    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = dark ? "#fafafa" : "#18181b";
    lines.forEach((line, index) => {
      ctx.fillText(line, width / 2, padY + (index + 0.5) * lineHeight + scale * 0.5);
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}

function DimensionItem({ guide, dark }: { guide: DimensionGuide; dark: boolean }) {
  const color = guideColor(guide, dark);
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array([
      ...guide.start, ...guide.end,
      ...guide.anchorA, ...guide.start,
      ...guide.anchorB, ...guide.end,
    ]);
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [guide.start, guide.end, guide.anchorA, guide.anchorB]);

  const badge = useMemo(() => createBadgeTexture(guide.label, color, dark), [guide.label, color, dark]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      badge.texture.dispose();
    };
  }, [geometry, badge]);

  const spriteHeight = guide.badgeHeight;
  const spriteWidth = spriteHeight * badge.aspect;

  return (
    <group>
      <lineSegments geometry={geometry} renderOrder={10}>
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={guide.highlighted ? 0.95 : 0.78} />
      </lineSegments>
      <sprite position={guide.labelPosition} scale={[spriteWidth, spriteHeight, 1]} renderOrder={11}>
        <spriteMaterial map={badge.texture} depthTest={false} transparent />
      </sprite>
    </group>
  );
}

export function SceneDimensions({ parts, selectedId, offsets, dark }: Props) {
  const guides = useMemo(() => buildDimensionGuides(parts, selectedId, offsets), [parts, selectedId, offsets]);
  if (guides.length === 0) return null;

  return (
    <group name="scene-dimensions">
      {guides.map((guide) => (
        <DimensionItem key={guide.id} guide={guide} dark={dark} />
      ))}
    </group>
  );
}
