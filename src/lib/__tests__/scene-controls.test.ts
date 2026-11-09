import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { ComponentRef } from "react";
import type { OrbitControls as ControlsComponent } from "@react-three/drei";
import { PerspectiveCamera, Vector3 } from "three";
import designJson from "../../../data/designs/standing-desk.json";
import { DesignSchema } from "../schema";
import { designBounds } from "../tslot";
import { applyViewFrame, frameRequest, frameView, type Vec3, type ViewAction } from "../scene-fit";
import { sceneControls } from "../scene-controls";

// 测试 drei 实际依赖的控件，并与相机共用 ESM three，避免混用模块实例。
const require = createRequire(import.meta.url);
const dreiRequire = createRequire(require.resolve("@react-three/drei"));
const controlsPackage = new URL("./package.json", pathToFileURL(dreiRequire.resolve("three-stdlib")));
const { exports: { import: controlsEntry } } = JSON.parse(await readFile(controlsPackage, "utf8"));
type Controls = ComponentRef<typeof ControlsComponent>;
const { OrbitControls } = await import(new URL(controlsEntry, controlsPackage).href) as {
  OrbitControls: new (camera: PerspectiveCamera, element: HTMLElement) => Controls;
};

class ControlSurface extends EventTarget {
  clientWidth = 800;
  clientHeight = 600;
  style = { touchAction: "auto" };
  ownerDocument = new EventTarget();
  releasePointerCapture() {}
}

function input(target: EventTarget, type: string, values: Record<string, number | string | boolean>) {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), values));
}

function pointer(x: number, y: number, button = 0, pointerId = 1, pointerType = "mouse") {
  return { clientX: x, clientY: y, pageX: x, pageY: y, button, pointerId, pointerType };
}

function fixture() {
  const design = DesignSchema.parse(designJson);
  const bounds = designBounds(design.parts);
  const camera = new PerspectiveCamera(38, 4 / 3);
  const element = new ControlSurface();
  const controls = new OrbitControls(camera, element as unknown as HTMLElement);
  Object.assign(controls, sceneControls);
  applyViewFrame(camera, controls, frameView(bounds, camera.fov, camera.aspect));
  return { design, bounds, camera, element, controls };
}

function settle(controls: Controls) {
  for (let i = 0; i < 300; i++) controls.update();
}

function drag(element: ControlSurface, button: number, extra = {}) {
  input(element, "pointerdown", { ...pointer(350, 250, button), ...extra });
  input(element.ownerDocument, "pointermove", { ...pointer(410, 270, button), ...extra });
  input(element.ownerDocument, "pointerup", { ...pointer(410, 270, button), ...extra });
}

test("画布鼠标左拖旋转、右拖或 Shift 平移、滚轮和中键缩放", () => {
  const { camera, controls, element, design } = fixture();
  const before = JSON.stringify(design);
  try {
    const target = controls.target.clone();
    const initialDirection = camera.position.clone().sub(target).normalize();
    const distance = camera.position.distanceTo(target);
    drag(element, 0);
    settle(controls);
    assert.ok(camera.position.clone().sub(target).normalize().distanceTo(initialDirection) > 0.1);
    assert.ok(controls.target.distanceTo(target) < 1e-8);
    assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-7);

    for (const [button, extra] of [[2, {}], [0, { shiftKey: true }]] as const) {
      const previousTarget = controls.target.clone();
      const direction = camera.position.clone().sub(controls.target).normalize();
      drag(element, button, extra);
      settle(controls);
      assert.ok(controls.target.distanceTo(previousTarget) > 1);
      assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(direction) < 1e-8);
    }

    const previousDistance = camera.position.distanceTo(controls.target);
    const previousTarget = controls.target.clone();
    input(element, "wheel", { deltaY: -100, deltaMode: 0 });
    settle(controls);
    assert.ok(camera.position.distanceTo(controls.target) < previousDistance);
    assert.ok(controls.target.distanceTo(previousTarget) < 1e-8);

    const zoomedDistance = camera.position.distanceTo(controls.target);
    drag(element, 1);
    settle(controls);
    assert.ok(Math.abs(camera.position.distanceTo(controls.target) - zoomedDistance) > 1);
    assert.equal(JSON.stringify(design), before);
  } finally {
    controls.dispose();
  }
});

test("触屏映射：单指旋转，双指缩放并平移，不改变设计尺寸", () => {
  const { camera, controls, element, design } = fixture();
  const before = JSON.stringify(design);
  try {
    const position = camera.position.clone();
    const target = controls.target.clone();
    input(element, "pointerdown", pointer(300, 250, 0, 1, "touch"));
    input(element.ownerDocument, "pointermove", pointer(330, 270, 0, 1, "touch"));
    input(element.ownerDocument, "pointerup", pointer(330, 270, 0, 1, "touch"));
    settle(controls);
    assert.ok(camera.position.distanceTo(position) > 1);
    assert.ok(controls.target.distanceTo(target) < 1e-8);

    const distance = camera.position.distanceTo(controls.target);
    input(element, "pointerdown", pointer(300, 250, 0, 1, "touch"));
    input(element, "pointerdown", pointer(400, 250, 0, 2, "touch"));
    input(element.ownerDocument, "pointermove", pointer(480, 280, 0, 2, "touch"));
    input(element.ownerDocument, "pointerup", pointer(300, 250, 0, 1, "touch"));
    input(element.ownerDocument, "pointerup", pointer(480, 280, 0, 2, "touch"));
    settle(controls);
    assert.ok(camera.position.distanceTo(controls.target) < distance);
    assert.ok(controls.target.distanceTo(target) > 1);
    assert.equal(JSON.stringify(design), before);
  } finally {
    controls.dispose();
  }
});

test("世界视角清理惯性，顶视稳定且后续仍能拖动旋转", () => {
  const { bounds, camera, controls, element } = fixture();
  try {
    for (const [id, action] of (["front", "right", "top", "reset"] as ViewAction[]).entries()) {
      drag(element, 0);
      const frame = frameRequest(bounds, camera.fov, camera.aspect, { id, action });
      applyViewFrame(camera, controls, frame);
      const position = camera.position.clone();
      settle(controls);
      assert.ok(camera.position.distanceTo(position) < 1e-7);
      assert.ok(camera.position.toArray().every(Number.isFinite));
      assert.ok(controls.target.distanceTo(new Vector3(...bounds.center)) < 1e-7);
      const direction = camera.position.clone().sub(controls.target).normalize();
      if (action === "top") {
        // 顶部极点需要向下拖动才能离开极角限制，而不是继续向上。
        input(element, "pointerdown", pointer(350, 250));
        input(element.ownerDocument, "pointermove", pointer(410, 180));
        input(element.ownerDocument, "pointerup", pointer(410, 180));
      } else drag(element, 0);
      settle(controls);
      assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(direction) > 0.01, action);
    }
  } finally {
    controls.dispose();
  }
});

test("惯性中适应视图后不再漂移；尺寸变化保留用户平移和缩放", () => {
  const { bounds, camera, controls, element } = fixture();
  try {
    drag(element, 2);
    const view = { position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3 };
    const fit = frameView(bounds, camera.fov, camera.aspect, view);
    applyViewFrame(camera, controls, fit);
    const position = camera.position.clone();
    settle(controls);
    assert.ok(camera.position.distanceTo(position) < 1e-8);
    assert.ok(controls.target.distanceTo(new Vector3(...bounds.center)) < 1e-8);
    assert.equal(controls.enableDamping, true);

    drag(element, 0);
    const rotating = { position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3 };
    const fitted = frameView(bounds, camera.fov, camera.aspect, rotating);
    applyViewFrame(camera, controls, fitted);
    const direction = camera.position.clone().sub(controls.target).normalize();
    settle(controls);
    assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(direction) < 1e-8);

    drag(element, 2);
    settle(controls);
    input(element, "wheel", { deltaY: -100 });
    settle(controls);
    const manualTarget = controls.target.clone();
    const ratio = camera.position.distanceTo(controls.target) / fit.fitDistance;
    const resized = frameView(bounds, 38, 0.5, {
      position: camera.position.toArray() as Vec3,
      target: controls.target.toArray() as Vec3,
    }, fit.fitDistance);
    camera.aspect = 0.5;
    applyViewFrame(camera, controls, resized);
    settle(controls);
    assert.ok(controls.target.distanceTo(manualTarget) < 1e-8);
    assert.ok(Math.abs(camera.position.distanceTo(controls.target) / resized.fitDistance - ratio) < 1e-8);
  } finally {
    controls.dispose();
  }
});
