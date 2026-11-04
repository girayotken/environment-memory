import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),track=z.string().regex(/^\d{1,8}$/);
export const VisualSegmentSchema=z.strictObject({
  id:hash,trackId:track,frameIndex:z.number().int().min(0).max(14999),
  sourceAsset:hash,cutoutAsset:hash,contextAsset:hash,
  bounds:z.strictObject({left:z.number().int().min(0),top:z.number().int().min(0),right:z.number().int().positive(),bottom:z.number().int().positive()}),
  width:z.number().int().positive(),height:z.number().int().positive(),foregroundPixels:z.number().int().positive(),
});
export const VisualBundleSchema=z.strictObject({
  id:hash,placeId:z.uuid(),media:z.enum(['image','video']),model:z.literal('sam-3.1'),concept:z.string().min(1).max(80),
  sourceSha256:hash,recordsSha256:hash,recordedAt:z.iso.datetime(),width:z.number().int().positive().max(640),height:z.number().int().positive().max(640),
  pixelSource:z.enum(['exact-saved-still','decoded-uploaded-video']),
  placeAssociation:z.literal('operator-declared'),segments:z.array(VisualSegmentSchema).min(1).max(512),
});
export const VisualLinkSchema=z.strictObject({
  id:hash,placeId:z.uuid(),bundleId:hash,segmentId:hash,frameId:z.uuid(),runId:z.uuid(),index:z.number().int().min(0).max(29),
  association:z.literal('reviewed-same-image'),note:z.string().min(1).max(400),
});
export type VisualSegment=z.infer<typeof VisualSegmentSchema>;
export type VisualBundle=z.infer<typeof VisualBundleSchema>;
export type VisualLink=z.infer<typeof VisualLinkSchema>;
export interface VisualEvidenceView {bundles:VisualBundle[];links:VisualLink[]}
export const visualAssetUrl=(hash:string)=>`/api/visual-assets/${hash}`;
