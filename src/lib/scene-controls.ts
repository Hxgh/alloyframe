import { MOUSE, TOUCH } from "three";

export const sceneControls = {
  enableRotate: true,
  enableZoom: true,
  enablePan: true,
  enableDamping: true,
  dampingFactor: 0.08,
  screenSpacePanning: true,
  zoomToCursor: false,
  autoRotate: false,
  rotateSpeed: 1,
  zoomSpeed: 1,
  panSpeed: 1,
  maxPolarAngle: Math.PI / 2 + 0.28,
  mouseButtons: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
  touches: { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
};
