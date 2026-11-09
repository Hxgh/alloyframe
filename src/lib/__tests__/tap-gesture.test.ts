import assert from "node:assert/strict";
import { test } from "node:test";
import { createTapGesture, isSelectionClick } from "../tap-gesture";

const pointer = (x = 0, y = 0, pointerId = 1) => ({ pointerId, clientX: x, clientY: y });

test("单指轻点可选择，按下但未抬起不选择", () => {
  const tap = createTapGesture();
  tap.down(pointer());
  assert.equal(tap.isTap(), false);
  tap.up(pointer(3, 2));
  assert.equal(tap.isTap(), true);
});

test("拖动后回到起点也不会误选；下一次轻点可正常选择", () => {
  const tap = createTapGesture();
  tap.down(pointer());
  tap.move(pointer(30));
  tap.up(pointer());
  assert.equal(tap.isTap(), false);
  tap.down(pointer());
  tap.up(pointer());
  assert.equal(tap.isTap(), true);
});

test("拖出画布后结束或失焦，下一次轻点仍正常", () => {
  const tap = createTapGesture();
  tap.down(pointer());
  tap.move(pointer(100, 100));
  tap.up(pointer(200, 200));
  assert.equal(tap.isTap(), false);
  tap.down(pointer());
  tap.up(pointer());
  assert.equal(tap.isTap(), true);
  tap.down(pointer());
  tap.reset();
  assert.equal(tap.isTap(), false);
  tap.down(pointer());
  tap.up(pointer());
  assert.equal(tap.isTap(), true);
});

test("双指手势和 pointercancel 都不可触发零件选择", () => {
  const tap = createTapGesture();
  tap.down(pointer());
  tap.down(pointer(10, 10, 2));
  tap.up(pointer());
  tap.up(pointer(10, 10, 2));
  assert.equal(tap.isTap(), false);
  tap.down(pointer());
  tap.cancel(pointer());
  tap.up(pointer());
  assert.equal(tap.isTap(), false);
});

test("鼠标非主键和修饰键手势不选择零件", () => {
  const tap = createTapGesture();
  for (const extra of [{ button: 1 }, { button: 2 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    tap.down({ ...pointer(), ...extra });
    tap.up({ ...pointer(), ...extra });
    assert.equal(tap.isTap(), false);
  }
  tap.down(pointer());
  tap.move({ ...pointer(), shiftKey: true });
  tap.up(pointer());
  assert.equal(tap.isTap(), false);
  tap.down(pointer());
  tap.up(pointer());
  assert.equal(tap.isTap(), true);
});

test("重复抬起幂等，空白清选排除右键菜单与修饰键", () => {
  const tap = createTapGesture();
  tap.down(pointer());
  tap.up(pointer());
  tap.up(pointer());
  assert.equal(tap.isTap(), true);
  assert.equal(isSelectionClick({ type: "click", button: 0 }), true);
  assert.equal(isSelectionClick({ type: "contextmenu", button: 2 }), false);
  assert.equal(isSelectionClick({ type: "dblclick", button: 0 }), false);
  assert.equal(isSelectionClick({ type: "click", button: 0, shiftKey: true }), false);
});
