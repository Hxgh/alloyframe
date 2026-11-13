import { Vector3, type PerspectiveCamera } from "three";

export type Vec3 = [number, number, number];
export type SceneBounds = {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  radius: number;
};

export function combineBounds(a: SceneBounds, b: SceneBounds): SceneBounds {
  const min = a.min.map((value, i) => Math.min(value, b.min[i])) as Vec3;
  const max = a.max.map((value, i) => Math.max(value, b.max[i])) as Vec3;
  return {
    min,
    max,
    center: min.map((value, i) => (value + max[i]) / 2) as Vec3,
    radius: Math.max(200, Math.hypot(...max.map((value, i) => value - min[i])) / 2),
  };
}

/** 取景使用真实包围半径；空项目保留默认视距，极小模型保留数值安全余量。 */
export function cameraBounds(bounds: SceneBounds, empty = false): SceneBounds {
  if (empty) return bounds;
  const radius = Math.hypot(...bounds.max.map((value, i) => value - bounds.min[i])) / 2;
  return { ...bounds, radius: Math.max(1, radius) };
}

/** 标尺开启时，取景同时涵盖尺寸线和文字位置，避免小模型的标注被裁掉。 */
export function boundsWithGuides(
  bounds: SceneBounds,
  guides: ReadonlyArray<{ start: Vec3; end: Vec3; anchorA: Vec3; anchorB: Vec3; labelPosition: Vec3; label: string; badgeHeight: number }>,
): SceneBounds {
  if (guides.length === 0) return bounds;
  const min = [...bounds.min] as Vec3;
  const max = [...bounds.max] as Vec3;
  const include = (point: Vec3, padding = 0) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i] - padding);
      max[i] = Math.max(max[i], point[i] + padding);
    }
  };
  for (const guide of guides) {
    for (const point of [guide.start, guide.end, guide.anchorA, guide.anchorB]) include(point);
    const lines = guide.label.split("\n");
    const height = guide.badgeHeight;
    // 兼容中文全角及画布左右留白，保守包住始终面向相机的标牌。
    const width = height * (Math.max(...lines.map((line) => line.length)) * 1.2 + 2) / (1.25 * lines.length + 0.85);
    include(guide.labelPosition, Math.hypot(width, height) / 2);
  }
  return {
    min,
    max,
    center: min.map((value, i) => (value + max[i]) / 2) as Vec3,
    radius: Math.max(1, Math.hypot(...max.map((value, i) => value - min[i])) / 2),
  };
}

/** 球体拟合同时约束水平/垂直视角，横竖屏均留出 10% 余量。 */
export function fitDistance(radius: number, verticalFov: number, aspect: number): number {
  const vertical = (verticalFov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.01));
  return (radius * 1.1) / Math.sin(Math.min(vertical, horizontal));
}

export type CameraView = { position: Vec3; target: Vec3 };
export type ViewAction = "fit" | "reset" | "front" | "right" | "top";
export type ViewRequest = { id: number; action: ViewAction };
export type ViewFrame = CameraView & {
  fitDistance: number;
  minDistance: number;
  maxDistance: number;
  near: number;
  far: number;
};

/** resize 保留平移和相对缩放；没有旧适配距离时重新居中、拟合。 */
export function frameView(
  bounds: SceneBounds,
  verticalFov: number,
  aspect: number,
  view?: CameraView,
  previousFitDistance?: number,
): ViewFrame {
  const fit = fitDistance(bounds.radius, verticalFov, aspect);
  const offset: Vec3 = view
    ? view.position.map((value, i) => value - view.target[i]) as Vec3
    : [0.66, 0.25, 0.71];
  const length = Math.hypot(...offset);
  const direction: Vec3 = length > 0 ? offset.map((value) => value / length) as Vec3 : [0, 0, 1];
  const preserveView = view !== undefined && previousFitDistance !== undefined && previousFitDistance > 0;
  const target = [...(preserveView ? view.target : bounds.center)] as Vec3;
  const minDistance = bounds.radius * 0.7;
  const maxDistance = fit * 5;
  const ratio = preserveView ? length / previousFitDistance : 1;
  const distance = Math.max(minDistance, Math.min(maxDistance, fit * ratio));
  const targetOffset = Math.hypot(...target.map((value, i) => value - bounds.center[i]));
  return {
    position: target.map((value, i) => value + direction[i] * distance) as Vec3,
    target,
    fitDistance: fit,
    minDistance,
    maxDistance,
    near: bounds.radius * 0.02,
    far: Math.max(bounds.radius * 40, maxDistance + targetOffset + bounds.radius * 2),
  };
}

/** 保留当前观察目标和方向，判断包围盒是否在相机视锥内；必要时只沿视线后退。 */
export function visibleBoundsDistance(
  bounds: SceneBounds,
  camera: PerspectiveCamera,
  target: Vec3,
  aspect: number,
  near = camera.near,
  padding = 1,
): number {
  const forward = new Vector3(...target).sub(camera.position).normalize();
  if (forward.lengthSq() === 0) return 0;
  const right = new Vector3().crossVectors(forward, camera.up).normalize();
  if (right.lengthSq() === 0) right.set(1, 0, 0);
  const up = new Vector3().crossVectors(right, forward).normalize();
  const vertical = Math.tan(camera.getEffectiveFOV() * Math.PI / 360);
  const horizontal = vertical * Math.max(aspect, 0.01);
  const origin = new Vector3(...target);
  let extra = 0;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = new Vector3(x, y, z).sub(camera.position);
        const depth = point.dot(forward);
        extra = Math.max(extra,
          Math.abs(point.dot(right)) * padding / horizontal - depth,
          Math.abs(point.dot(up)) * padding / vertical - depth,
          near - depth,
        );
      }
    }
  }
  if (extra <= 1e-7) return 0;
  // 只留极小余量，避免刚好落在裁剪边界受浮点误差影响。
  return extra + Math.max(bounds.radius * 0.001, origin.distanceTo(camera.position) * 1e-6);
}

export type ViewState = { bounds: SceneBounds; requestId: number; distance: number };

/** 新命令重新拟合；同一命令下的尺寸变化不重放视角，保留用户操作。 */
export function frameRequest(
  bounds: SceneBounds,
  verticalFov: number,
  aspect: number,
  request: ViewRequest,
  view?: CameraView,
  previous?: ViewState,
): ViewFrame {
  if (previous?.requestId === request.id) {
    const sameBounds = previous.bounds.min.every((value, i) => value === bounds.min[i] && previous.bounds.max[i] === bounds.max[i]);
    return frameView(bounds, verticalFov, aspect, view, sameBounds ? previous.distance : undefined);
  }
  if (request.action === "reset") return frameView(bounds, verticalFov, aspect);
  const directions: Partial<Record<ViewAction, Vec3>> = {
    front: [0, 0, 1],
    right: [1, 0, 0],
    // 留出极小倾角，顶视屏幕上方为 −Z，同时避开 Y-up 的极点。
    top: [0, 1, 0.000001],
  };
  const direction = directions[request.action];
  return frameView(bounds, verticalFov, aspect, direction ? {
    target: bounds.center,
    position: bounds.center.map((value, i) => value + direction[i]) as Vec3,
  } : view);
}

type ViewControls = {
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  enableDamping: boolean;
  update: () => unknown;
};

export function applyViewFrame(camera: PerspectiveCamera, controls: ViewControls, frame: ViewFrame) {
  const damping = controls.enableDamping;
  // 先通过公开 update 清掉惯性，再写入目标视角，避免 fit 后继续漂移。
  controls.enableDamping = false;
  controls.update();
  camera.position.fromArray(frame.position);
  camera.near = frame.near;
  camera.far = frame.far;
  camera.updateProjectionMatrix();
  controls.target.fromArray(frame.target);
  controls.minDistance = frame.minDistance;
  controls.maxDistance = frame.maxDistance;
  controls.update();
  controls.enableDamping = damping;
}
