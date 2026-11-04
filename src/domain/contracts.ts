import { z } from 'zod';

export const ZoneSchema = z.enum(['bench', 'storage', 'parts']);
export type Zone = z.infer<typeof ZoneSchema>;
export const zoneLabels: Record<Zone, string> = { bench: 'Bench', storage: 'Storage shelf', parts: 'Parts station' };

// Deliberately allowlisted: renderer truth cannot be added to this envelope.
export const FrameSchema = z.strictObject({
  frameId: z.uuid(),
  capturedAt: z.iso.datetime(),
  zone: ZoneSchema,
  source: z.literal('virtual-camera'),
  referenceView: z.enum(['workshop-v2-bench', 'workshop-v2-storage', 'workshop-v2-parts']).optional(),
  width: z.number().int().min(64).max(2560),
  height: z.number().int().min(64).max(2560),
  imageDataUrl: z.string().max(6_000_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
}).refine(frame => !frame.referenceView || frame.referenceView === `workshop-v2-${frame.zone}`, 'Reference view does not match zone');
export type FrameEnvelope = z.infer<typeof FrameSchema>;

export const ObservationSchema = z.strictObject({
  label: z.string().min(1).max(160),
  appearance: z.string().max(600),
  locationDescription: z.string().max(600),
  uncertainty: z.string().max(600),
  bbox: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).nullable(),
}).refine(value => !value.bbox || (value.bbox[0] < value.bbox[2] && value.bbox[1] < value.bbox[3]), 'Invalid bounding box order');
export const ObservationsSchema = z.strictObject({
  summary: z.string().max(1200),
  objects: z.array(ObservationSchema).max(30),
});
export type Observations = z.infer<typeof ObservationsSchema>;
export const ReplaySchema = z.strictObject({
  schemaVersion: z.literal(1),
  provenance: z.enum(['authored_fixture', 'imported_model_output']),
  model: z.string().min(1).max(160),
  observations: ObservationsSchema,
});
export type ReplayInput = z.infer<typeof ReplaySchema>;
export const RunSchema = z.strictObject({
  id: z.uuid(), frameId: z.uuid(), mode: z.enum(['mock', 'live', 'replay']),
  model: z.string().min(1).max(160), createdAt: z.iso.datetime(),
  latencyMs: z.number().int().nonnegative(), observations: ObservationsSchema,
  usage: z.record(z.string(), z.number().nonnegative()),
  provenance: z.enum(['authored_fixture', 'imported_model_output']).optional(),
}).superRefine((run, context) => {
  if (run.mode === 'replay' ? !run.provenance : Boolean(run.provenance)) {
    context.addIssue({ code: 'custom', message: 'Only replay runs require declared provenance' });
  }
});
export type ObservationRun = z.infer<typeof RunSchema>;
export type Mode = ObservationRun['mode'];
export interface SavedFrame {
  id: string; capturedAt: string; zone: Zone; source: 'virtual-camera';
  width: number; height: number; imageHash: string; imageUrl: string;
  run: ObservationRun | null;
  referenceView?: FrameEnvelope['referenceView'];
}
export interface Health {
  readOnly?:boolean;
  liveEnabled: boolean; liveConfigured: boolean; creditConfirmed: boolean;
  model: string; provider: string; storage: string;
}

export function makeCapture(pixels: { imageDataUrl: string; width: number; height: number; referenceView?: FrameEnvelope['referenceView'] }, zone: Zone): FrameEnvelope {
  return FrameSchema.parse({ frameId: crypto.randomUUID(), capturedAt: new Date().toISOString(), zone,
    source: 'virtual-camera', ...pixels });
}
