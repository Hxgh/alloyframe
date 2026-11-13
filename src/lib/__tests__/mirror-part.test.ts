import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import catalogJson from "../../../data/catalog/profiles.json";
import accessoriesJson from "../../../data/catalog/accessories.json";
import { beamDims } from "../materials";
import { mirrorPart, nextPartId, type MirrorAxis } from "../project-draft";
import { AccessoryCatalogSchema, CatalogSchema, DesignSchema, IdSchema, PartSchema, type Part } from "../schema";
import { beamGeometry, designBounds, partRotation, tSlotShape } from "../tslot";
import { inspectDesign } from "../validation";

const catalog = CatalogSchema.parse(catalogJson);
const accessories = AccessoryCatalogSchema.parse(accessoriesJson);
const profile = catalog.profiles.find((item) => item.id === "4040")!;
type Vec3 = [number, number, number];

function fixture(overrides: Partial<Part> = {}): Part {
  return PartSchema.parse({
    id: "rail-left", kind: "beam", profile: profile.id, role: "梁", material: "铝",
    size: [1000, 40, 80], position: [-250, 1000, 300], rotation: [20, 0, 30],
    ...overrides,
  });
}

function renderMatrix(part: Part): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeRotationFromEuler(new THREE.Euler(...partRotation(part)))
    .setPosition(...part.position);
}

function reflect(point: THREE.Vector3, axis: MirrorAxis): THREE.Vector3 {
  const result = point.clone();
  if (axis === "x") result.x = -result.x;
  else result.z = -result.z;
  return result;
}

function localSize(part: Part, fallbackBox = false): Vec3 {
  if (part.kind !== "beam" || fallbackBox) return part.size;
  const { sectionW, sectionH, length } = beamDims(part);
  return [sectionW, sectionH, length];
}

function corners(part: Part, fallbackBox = false): THREE.Vector3[] {
  const [x, y, z] = localSize(part, fallbackBox).map((n) => n / 2);
  const matrix = renderMatrix(part);
  return [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) =>
    new THREE.Vector3(sx * x, sy * y, sz * z).applyMatrix4(matrix),
  )));
}

function assertPointSets(actual: THREE.Vector3[], expected: THREE.Vector3[], label: string, tolerance = 1e-7) {
  const hasMatch = (point: THREE.Vector3, points: THREE.Vector3[]) =>
    points.some((candidate) => point.distanceTo(candidate) <= tolerance);
  for (const point of actual) assert.ok(hasMatch(point, expected), `${label}: 意外点 ${point.toArray()}`);
  for (const point of expected) assert.ok(hasMatch(point, actual), `${label}: 缺少点 ${point.toArray()}`);
}

function assertMirroredCorners(part: Part, mirrored: Part, axis: MirrorAxis, fallbackBox = false) {
  assertPointSets(
    corners(mirrored, fallbackBox),
    corners(part, fallbackBox).map((point) => reflect(point, axis)),
    `${part.id} ${axis} 包围角点`,
  );
}

function geometryPoints(part: Part): THREE.Vector3[] {
  const { sectionW, sectionH, length } = beamDims(part);
  const geometry = beamGeometry(profile, sectionW, sectionH, length);
  try {
    const position = geometry.getAttribute("position");
    const unique = new Map<string, THREE.Vector3>();
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      unique.set(point.toArray().join(","), point);
    }
    const matrix = renderMatrix(part);
    return [...unique.values()].map((point) => point.applyMatrix4(matrix));
  } finally {
    geometry.dispose();
  }
}

test("复合旋转的 X 向矩形型材镜像后保留 Y 范围与全部外包角点", () => {
  const part = fixture();
  const before = structuredClone(part);
  const mirrored = mirrorPart(part, [part.id], "x");
  const originalBounds = designBounds([part]);
  const mirroredBounds = designBounds([mirrored]);
  assert.ok(Math.abs(originalBounds.min[1] - mirroredBounds.min[1]) < 1e-7);
  assert.ok(Math.abs(originalBounds.max[1] - mirroredBounds.max[1]) < 1e-7);
  assertMirroredCorners(part, mirrored, "x");
  assert.deepEqual(part, before);
  assert.ok(PartSchema.safeParse(mirrored).success);
});

test("各长轴、矩形截面及复合旋转均按渲染矩阵镜像，二次镜像恢复角点", () => {
  const sizes: Vec3[] = [
    [1000, 40, 80], [1000, 80, 40], [40, 1000, 80], [80, 1000, 40],
    [40, 80, 1000], [80, 40, 1000], [40, 40, 40],
  ];
  const rotations: Vec3[] = [[0, 0, 0], [20, 0, 30], [23, -31, 47], [-72, 126, 211]];
  for (const size of sizes) for (const rotation of rotations) for (const axis of ["x", "z"] as const) {
    const part = fixture({ size, rotation });
    const mirrored = mirrorPart(part, [part.id], axis);
    assertMirroredCorners(part, mirrored, axis);
    const sourceBounds = designBounds([part]);
    const mirrorBounds = designBounds([mirrored]);
    const reflectedIndex = axis === "x" ? 0 : 2;
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(mirrorBounds.min[i] - (i === reflectedIndex ? -sourceBounds.max[i] : sourceBounds.min[i])) < 1e-7);
      assert.ok(Math.abs(mirrorBounds.max[i] - (i === reflectedIndex ? -sourceBounds.min[i] : sourceBounds.max[i])) < 1e-7);
    }
    // profile 不可用时 PartMesh 回退到 boxGeometry，依旧沿 partRotation 旋转。
    assertMirroredCorners(part, mirrored, axis, true);
    const twice = mirrorPart(mirrored, [part.id, mirrored.id], axis);
    assertPointSets(corners(twice), corners(part), `二次 ${axis} 镜像`);
    assert.ok(PartSchema.safeParse(mirrored).success);
    assert.ok(PartSchema.safeParse(twice).success);
  }
});

test("无旋转的各轴型材及盒体镜像仍呈现零角度，极小旋转不会被抹去", () => {
  const sizes: Vec3[] = [[1000, 40, 80], [40, 1000, 80], [40, 80, 1000]];
  for (const kind of ["beam", "box"] as const) for (const size of sizes) for (const axis of ["x", "z"] as const) {
    const part = fixture({ kind, profile: kind === "beam" ? profile.id : null, size, rotation: [0, 0, 0] });
    const mirrored = mirrorPart(part, [part.id], axis);
    assert.deepEqual(mirrored.rotation, [0, 0, 0]);
    assertMirroredCorners(part, mirrored, axis);
    if (kind === "beam") assertPointSets(geometryPoints(mirrored), geometryPoints(part).map((p) => reflect(p, axis)), "零角挤出几何", 1e-6);
  }
  const tiny = fixture({ size: [40, 80, 1000], rotation: [1e-9, 0, 0] });
  assert.notDeepEqual(mirrorPart(tiny, [tiny.id], "x").rotation, [0, 0, 0]);
});

test("确定性多角度回归始终保持反射后的真实角点", () => {
  let seed = 0x6d697272;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const sizes: Vec3[] = [[1000, 40, 80], [40, 1000, 80], [80, 40, 1000]];
  for (let i = 0; i < 1000; i++) {
    const part = fixture({
      size: sizes[i % sizes.length],
      rotation: [random() * 1440 - 720, random() * 1440 - 720, random() * 1440 - 720],
    });
    const axis = i % 2 === 0 ? "x" : "z";
    assertMirroredCorners(part, mirrorPart(part, [part.id], axis), axis);
  }
});

test("渲染型材的槽与孔截面在两横截轴对称，实际挤出顶点整体正确反射", () => {
  for (const [width, height] of [[40, 40], [40, 80], [80, 40], [35, 65], [40, 160]]) {
    const { shape, holes } = tSlotShape(profile, width, height).extractPoints(6);
    for (const points of [shape, holes.flat()]) {
      const vectors = points.map((point) => new THREE.Vector3(point.x, point.y, 0));
      assertPointSets(vectors.map((p) => new THREE.Vector3(-p.x, p.y, 0)), vectors, `${width}×${height} 截面 X 对称`);
      assertPointSets(vectors.map((p) => new THREE.Vector3(p.x, -p.y, 0)), vectors, `${width}×${height} 截面 Y 对称`);
    }
  }
  for (const size of [
    [1000, 40, 40], [1000, 40, 80], [1000, 80, 40], [40, 1000, 80], [80, 1000, 40],
    [40, 80, 1000], [80, 40, 1000], [1000, 35, 65], [1000, 40, 160],
  ] as Vec3[]) {
    for (const axis of ["x", "z"] as const) {
      const part = fixture({ size, rotation: [20, -37, 61] });
      const mirrored = mirrorPart(part, [part.id], axis);
      assertPointSets(
        geometryPoints(mirrored),
        geometryPoints(part).map((point) => reflect(point, axis)),
        `${size.join("×")} ${axis} 实际挤出顶点`,
        1e-6,
      );
    }
  }
});

test("极点附近的长构件不因小余弦阈值产生肉眼可见误差", () => {
  const length = 1e16;
  for (const sign of [-1, 1]) for (const axis of ["x", "z"] as const) {
    const part = fixture({
      size: [40, 80, length], position: [200, length, 300],
      rotation: [27, sign * (90 - 4e-14), -43],
    });
    const mirrored = mirrorPart(part, [part.id], axis);
    assertPointSets(corners(mirrored), corners(part).map((point) => reflect(point, axis)), "极长型材极点", 4);
    assert.ok(PartSchema.safeParse(mirrored).success);
  }
});

test("欧拉角极点及其附近的反射不丢失有效旋转", () => {
  // X 型材还要扣除 partRotation 自带的 Y=90° 基准角。
  for (const size of [[1000, 40, 80], [40, 1000, 80], [40, 80, 1000]] as Vec3[]) {
    const baseY = size[0] === 1000 ? 90 : 0;
    for (const renderedY of [90, -90, 90 - 1e-7, 90 + 1e-7, -90 + 1e-7, -90 - 1e-7, 90 - 0.01]) {
      for (const axis of ["x", "z"] as const) {
        const part = fixture({ size, rotation: [27, renderedY - baseY, -43] });
        assertMirroredCorners(part, mirrorPart(part, [part.id], axis), axis);
      }
    }
  }
});

test("盒、板及柱均使用对应渲染几何，镜像不修改原设计或共享 size 数组", () => {
  for (const kind of ["box", "plate", "column"] as const) for (const axis of ["x", "z"] as const) {
    const part = fixture({ kind, profile: null, size: [900, 80, 40], rotation: [13, 47, -28] });
    const design = DesignSchema.parse({ id: "desk", name: "桌", units: "mm", parts: [part] });
    const snapshot = structuredClone(design);
    const mirrored = mirrorPart(design.parts[0], [], axis);
    assertMirroredCorners(part, mirrored, axis);
    assert.ok(PartSchema.safeParse(mirrored).success);
    assert.deepEqual(design, snapshot);
    assert.notEqual(mirrored.size, design.parts[0].size);
    mirrored.size[0]++;
    assert.deepEqual(design, snapshot);
  }
});

test("镜像和复制 ID 唯一且不超过 120 字符，即使语义替换和递增编号截断", () => {
  const ids = ["a".repeat(120), `${"a".repeat(115)}-left`, `${"a".repeat(117)}-bc`];
  for (const source of ids) {
    const part = fixture({ id: source });
    const existing = [source];
    for (let i = 0; i < 130; i++) {
      const mirrored = mirrorPart(part, existing, "x");
      assert.ok(IdSchema.safeParse(mirrored.id).success, mirrored.id);
      assert.ok(PartSchema.safeParse(mirrored).success);
      assert.ok(!existing.includes(mirrored.id));
      existing.push(mirrored.id);
      const copiedId = nextPartId(existing, source);
      assert.ok(IdSchema.safeParse(copiedId).success, copiedId);
      assert.ok(!existing.includes(copiedId));
      existing.push(copiedId);
    }
  }
  assert.equal(mirrorPart(fixture(), [], "x").id, "rail-right");
  assert.equal(mirrorPart(fixture(), ["rail-right"], "x").id, "rail-right-1");
  assert.equal(mirrorPart(fixture({ id: "rail-front" }), [], "z").id, "rail-back");
  assert.equal(mirrorPart(fixture({ id: "a".repeat(120) }), [], "x").id, `${"a".repeat(111)}-mirror-x`);
  assert.equal(mirrorPart(fixture({ id: `${"a".repeat(115)}-left` }), [], "x").id, `${"a".repeat(114)}-right`);
  const startsWithLeft = fixture({ id: `left-${"a".repeat(115)}` });
  assert.equal(mirrorPart(startsWithLeft, [], "x").id, `right-${"a".repeat(114)}`);
  for (const id of [`a-left-${"b".repeat(113)}`, `a-left-${"b".repeat(110)}-c`]) {
    const mirrored = mirrorPart(fixture({ id }), [], "x");
    assert.ok(IdSchema.safeParse(mirrored.id).success, mirrored.id);
    assert.ok(mirrored.id.startsWith("a-right-"), mirrored.id);
    assert.ok(!mirrored.id.endsWith("-"), mirrored.id);
  }
  const collisionIds = ["rail-right", "rail-right-1", "rail-right-2"];
  const collisionSnapshot = [...collisionIds];
  assert.equal(mirrorPart(fixture(), collisionIds, "x").id, "rail-right-3");
  assert.deepEqual(collisionIds, collisionSnapshot);
});

test("输出消除正负零且镜像后仍可通过设计校验", () => {
  for (const axis of ["x", "z"] as const) {
    const part = fixture({ position: [-0, 1000, -0], rotation: [-0, 0, -0] });
    const mirrored = mirrorPart(part, [part.id], axis);
    for (const value of [...mirrored.position, ...mirrored.rotation]) {
      assert.ok(!Object.is(value, -0), "输出不得包含负零");
      assert.ok(Number.isFinite(value));
    }
    const result = inspectDesign({ id: "desk", name: "桌", units: "mm", parts: [part, mirrored] }, catalog, accessories);
    assert.ok(result.design, JSON.stringify(result.issues));
  }
});
