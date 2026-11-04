/** Bounds the longer side while preserving the camera frame's aspect ratio. */
export function cameraFrameSize(width: number, height: number, maxSide = 1920) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Invalidate pending permission requests as well as stopping an existing stream. */
export function createCameraLease() {
  let generation = 0;
  let current: MediaStream | null = null;
  const stop = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop());
  return {
    close() { generation++; stop(current); current = null; },
    async open(request: () => Promise<MediaStream>) {
      const ticket = ++generation;
      stop(current); current = null;
      const stream = await request();
      if (ticket !== generation) { stop(stream); return null; }
      current = stream;
      return stream;
    },
  };
}
