/** The virtual phone uses one portrait sensor profile for preview and saved pixels. */
export const PHONE_CAPTURE_WIDTH = 1080;
export const PHONE_CAPTURE_HEIGHT = 1920;
export const PHONE_CAPTURE_ASPECT = PHONE_CAPTURE_WIDTH / PHONE_CAPTURE_HEIGHT;
export const PHONE_CAPTURE_VERTICAL_FOV = 70;

/** Apply the same optical profile whenever the preview is fitted or reset. */
export function applyPhoneProjection(camera: { aspect:number; fov:number; zoom:number; updateProjectionMatrix():void }) {
  camera.aspect = PHONE_CAPTURE_ASPECT;
  camera.fov = PHONE_CAPTURE_VERTICAL_FOV;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}

/** Render once at sensor resolution, then restore the inexpensive preview even on failure. */
export function capturePhoneFrame(renderer: {
  getPixelRatio(): number;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  domElement: { toDataURL(type: string): string };
}, previewWidth: number, previewHeight: number, render: () => void) {
  const pixelRatio = renderer.getPixelRatio();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(PHONE_CAPTURE_WIDTH, PHONE_CAPTURE_HEIGHT, false);
    render();
    return { imageDataUrl: renderer.domElement.toDataURL('image/png'), width: PHONE_CAPTURE_WIDTH, height: PHONE_CAPTURE_HEIGHT };
  } finally {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(previewWidth, previewHeight, false);
    render();
  }
}
