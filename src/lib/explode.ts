import type { Part } from "./schema";
import { longAxis } from "./materials";
import { designBounds } from "./tslot";

export type ExplodeVector = [number, number, number];

/**
 * 计算零件的拆解位移。
 *
 * 规则（纯几何推导，无需手写拆解数据）：
 *  1. 型材沿「垂直于自身长轴」的方向外推 —— 平行的两根梁会左右分开，
 *     而不是沿着自己的长度滑走。
 *  2. 竖直件（长轴为 y）沿 +y 上抬。
 *  3. 平板（台面）最后单独上抬，露在最上方。
 *  4. 向下分离不超过旋转后的离地净空，保证原本未穿地的零件全程不穿地。
 *
 * amount = 0 时全部位移为 0，保证可逆。
 */
export function explodeOffsets(parts: Part[], amount: number): Map<string, ExplodeVector> {
  const result = new Map<string, ExplodeVector>();
  if (parts.length === 0 || amount <= 0) {
    for (const p of parts) result.set(p.id, [0, 0, 0]);
    return result;
  }

  // 模型中心与尺度，用于把位移归一化
  let cx = 0,
    cy = 0,
    cz = 0;
  let maxSpan = 1;
  for (const p of parts) {
    cx += p.position[0];
    cy += p.position[1];
    cz += p.position[2];
    maxSpan = Math.max(maxSpan, ...p.size);
  }
  cx /= parts.length;
  cy /= parts.length;
  cz /= parts.length;

  const strength = amount * maxSpan * 0.14;
  // 中心附近视为 0 的量程，避免对称件因浮点误差乱跳
  const deadzone = maxSpan * 0.04;

  for (const part of parts) {
    const off: ExplodeVector = [0, 0, 0];
    const axis = longAxis(part);

    if (part.kind === "plate") {
      // 台面：抬到最上面，让下面的框体露出来
      off[1] = strength * 1.6;
      result.set(part.id, off);
      continue;
    }

    if (part.kind === "column") {
      // 升降柱是伸缩结构：内管向上抽出，外管留在原地 —— 这样才看得出原理
      const isInner = /内/.test(part.role);
      off[1] = isInner ? strength * 1.15 : strength * 0.16;
      // 左右两根柱子在水平方向也拉开
      off[0] = sign(part.position[0] - cx) * strength * 0.3;
      result.set(part.id, off);
      continue;
    }

    if (axis === "y") {
      // 其它竖直件：向上抽离
      off[1] = strength * 0.45;
      off[0] = sign(part.position[0] - cx) * strength * 0.25;
      off[2] = sign(part.position[2] - cz) * strength * 0.25;
    } else {
      // 水平梁：沿垂直于长轴的两个方向散开
      const perp: Array<0 | 2> = axis === "x" ? [2] : [0];
      for (const idx of perp) {
        const d = part.position[idx] - (idx === 0 ? cx : cz);
        off[idx] = (Math.abs(d) < deadzone ? 0 : Math.sign(d)) * strength;
      }
      // 高度不同的梁再叠一点竖直分离
      const dy = part.position[1] - cy;
      off[1] = (Math.abs(dy) < deadzone ? 0 : Math.sign(dy)) * strength * 0.35;
    }

    if (off[1] < 0) {
      const clearance = Math.max(0, designBounds([part]).min[1]);
      // 按满拆净空线性缩放，避免中途触地截停改变拆解节奏。
      off[1] = Math.max(off[1], -clearance * amount) || 0;
    }

    result.set(part.id, off);
  }

  return result;
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** 判断某个零件是否是"主要结构件"（用于零件树里的分组） */
export function isStructural(part: Part): boolean {
  return part.kind === "beam" || part.kind === "column";
}
