import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import designJson from "../../data/designs/standing-desk.json";
import { DesignSchema } from "./schema";
import { designBounds } from "./tslot";
import { explodeOffsets } from "./explode";
import { combineBounds, fitDistance, frameRequest, frameView, type Vec3, type ViewAction } from "./scene-fit";

const design = DesignSchema.parse(designJson);
const assembled = designBounds(design.parts);
const exploded = designBounds(design.parts, explodeOffsets(design.parts, 1));
const bounds = combineBounds(assembled, exploded);

test("窄画布取景距离增大，水平和垂直都完整覆盖拆解过程", () => {
  assert.ok(fitDistance(bounds.radius, 38, 0.5) > fitDistance(bounds.radius, 38, 2));
  for (const aspect of [0.25, 0.5, 1, 1.5, 2.8]) {
    for (const direction of [new Vector3(0.66, 0.25, 0.71), new Vector3(-1, 0.7, -0.3)]) {
      const camera = new PerspectiveCamera(38, aspect, 1, 100000);
      const center = new Vector3(...bounds.center);
      camera.position.copy(center).addScaledVector(direction.normalize(), fitDistance(bounds.radius, 38, aspect));
      camera.lookAt(center);
      camera.updateMatrixWorld();
      for (const amount of [0, 0.5, 1]) {
        const state = designBounds(design.parts, explodeOffsets(design.parts, amount));
        for (const x of [state.min[0], state.max[0]]) {
          for (const y of [state.min[1], state.max[1]]) {
            for (const z of [state.min[2], state.max[2]]) {
              const ndc = new Vector3(x, y, z).project(camera);
              assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1, `aspect=${aspect}, amount=${amount}`);
            }
          }
        }
      }
    }
  }
});

test("包围盒包含拆解位移与旋转，不修改源数据", () => {
  const parts = [{ id: "test", size: [1000, 20, 40] as [number, number, number], position: [500, 20, -200] as [number, number, number], rotation: [0, 0, 90] as [number, number, number] }];
  const original = JSON.stringify(parts);
  const box = designBounds(parts, new Map([["test", [50, 100, -20]]]));
  assert.deepEqual(box.center, [550, 120, -220]);
  assert.ok(Math.abs(box.max[0] - box.min[0] - 20) < 1e-6);
  assert.ok(Math.abs(box.max[1] - box.min[1] - 1000) < 1e-6);
  assert.equal(JSON.stringify(parts), original);
});

test("非方截面 Y 向型材的附加旋转与渲染采用同一变换", () => {
  const box = designBounds([{
    id: "beam", kind: "beam", size: [40, 1000, 80], position: [0, 0, 0], rotation: [0, 0, 90],
  }]);
  assert.ok(Math.abs(box.max[0] - box.min[0] - 80) < 1e-6);
  assert.ok(Math.abs(box.max[1] - box.min[1] - 1000) < 1e-6);
  assert.ok(Math.abs(box.max[2] - box.min[2] - 40) < 1e-6);
});

test("装配和最大拆解的联合边界覆盖中间状态", () => {
  for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
    const current = designBounds(design.parts, explodeOffsets(design.parts, amount));
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(current.min[axis] >= bounds.min[axis]);
      assert.ok(current.max[axis] <= bounds.max[axis]);
    }
  }
});

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, i) => value - b[i]));

test("正、右、顶视按世界坐标居中取景，重置回默认斜视", () => {
  const before = JSON.stringify(design);
  const view = { position: [-450, 1300, 1700] as Vec3, target: [200, 400, -100] as Vec3 };
  const expected: Array<[ViewAction, Vec3]> = [["front", [0, 0, 1]], ["right", [1, 0, 0]], ["top", [0, 1, 0.000001]]];
  for (const [action, direction] of expected) {
    const frame = frameRequest(bounds, 38, 0.5, { id: 1, action }, view);
    const actual = new Vector3(...frame.position).sub(new Vector3(...frame.target)).normalize();
    assert.ok(actual.distanceTo(new Vector3(...direction).normalize()) < 1e-8);
    assert.deepEqual(frame.target, bounds.center);
    assert.ok(frame.position.every(Number.isFinite));
    assert.ok(Math.abs(distance(frame.position, frame.target) - frame.fitDistance) < 1e-7);
  }
  const reset = frameRequest(bounds, 38, 1.5, { id: 2, action: "reset" }, view);
  assert.deepEqual(reset, frameView(bounds, 38, 1.5));
  assert.equal(JSON.stringify(design), before);
});

test("重复视角用新编号重新居中，同编号 resize 保留平移和相对缩放", () => {
  const request = { id: 2, action: "top" as const };
  const initial = frameRequest(bounds, 38, 1.5, request);
  const target = initial.target.map((value, i) => value + [150, 80, -120][i]) as Vec3;
  const view = {
    target,
    position: initial.position.map((value, i) => target[i] + (value - initial.target[i]) * 0.6) as Vec3,
  };
  const previous = { bounds, requestId: request.id, distance: initial.fitDistance };
  const resized = frameRequest(bounds, 38, 0.5, request, view, previous);
  assert.deepEqual(resized.target, target);
  assert.ok(Math.abs(distance(resized.position, resized.target) / resized.fitDistance - 0.6) < 1e-8);
  const repeated = frameRequest(bounds, 38, 0.5, { ...request, id: 3 }, view, previous);
  assert.deepEqual(repeated.target, bounds.center);
  assert.ok(Math.abs(distance(repeated.position, repeated.target) / repeated.fitDistance - 1) < 1e-8);
  const equivalentBounds = structuredClone(bounds);
  const unchangedGeometry = frameRequest(equivalentBounds, 38, 1.5, request, view, previous);
  assert.deepEqual(unchangedGeometry.target, target);
  assert.ok(Math.abs(distance(unchangedGeometry.position, unchangedGeometry.target) / unchangedGeometry.fitDistance - 0.6) < 1e-8);
});

test("横竖屏和面板尺寸往返保留平移及相对缩放", () => {
  const initial = frameView(bounds, 38, 1.5);
  const offset = [150, 80, -120];
  const target = initial.target.map((value, i) => value + offset[i]) as Vec3;
  const view = {
    target,
    position: initial.position.map((value, i) => target[i] + (value - initial.target[i]) * 0.6) as Vec3,
  };
  const before = JSON.stringify(view);
  let frame = { ...initial, ...view };
  for (const aspect of [0.5, 0.25, 2.8, 1.5]) {
    frame = frameView(bounds, 38, aspect, frame, frame.fitDistance);
    assert.deepEqual(frame.target, target);
    assert.ok(Math.abs(distance(frame.position, frame.target) / frame.fitDistance - 0.6) < 1e-10);
  }
  assert.ok(distance(frame.position, view.position) < 1e-8);
  assert.equal(JSON.stringify(view), before);
});

test("显式适应视图重新居中，保留用户观察方向且不改变设计", () => {
  const before = JSON.stringify(design);
  const view = { target: [250, 30, -80] as Vec3, position: [-850, 630, 1220] as Vec3 };
  const frame = frameView(bounds, 38, 0.5, view);
  assert.deepEqual(frame.target, bounds.center);
  assert.ok(Math.abs(distance(frame.position, frame.target) - frame.fitDistance) < 1e-8);
  const oldDirection = new Vector3(...view.position).sub(new Vector3(...view.target)).normalize();
  const newDirection = new Vector3(...frame.position).sub(new Vector3(...frame.target)).normalize();
  assert.ok(oldDirection.distanceTo(newDirection) < 1e-10);
  assert.equal(JSON.stringify(design), before);
});

test("极窄画布的最远允许距离仍在远裁剪面内", () => {
  for (const aspect of [0.01, 0.25, 0.5, 2.8]) {
    const view = { position: [100000, 50000, 100000] as Vec3, target: [5000, 0, -3000] as Vec3 };
    const frame = frameView(bounds, 38, aspect, view, 1);
    const targetOffset = distance(frame.target, bounds.center);
    assert.ok(frame.far > frame.maxDistance + targetOffset + bounds.radius);
    assert.ok(frame.position.every(Number.isFinite));
    assert.ok(distance(frame.position, frame.target) <= frame.maxDistance + 1e-6);
  }
});
