import * as THREE from "three";
import type { AccessoryVisual } from "./accessory-connections";

/** 带安装孔的 L 形角码示意，非供应商加工 CAD。外安装面为 x=0 和 y=0。 */
export function angleBracketGeometries(visual: AccessoryVisual): THREE.ExtrudeGeometry[] {
  const [x, y, width] = visual.size;
  const { thickness, holeDiameter } = visual;
  function plate(minX: number, minY: number, maxX: number, maxY: number, holeX: number, holeY: number) {
    const shape = new THREE.Shape();
    shape.moveTo(minX, minY);
    shape.lineTo(maxX, minY);
    shape.lineTo(maxX, maxY);
    shape.lineTo(minX, maxY);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(holeX, holeY, holeDiameter / 2, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 16 });
  }
  const upright = plate(-width / 2, 0, width / 2, y, 0, (y + thickness) / 2);
  upright.rotateY(Math.PI / 2);
  const base = plate(0, -width / 2, x, width / 2, (x + thickness) / 2, 0);
  base.rotateX(-Math.PI / 2);
  return [upright, base];
}
