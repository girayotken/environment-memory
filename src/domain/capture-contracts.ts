import {z} from 'zod';

export const CAPTURE_MAX_FRAMES=12;
export const CAPTURE_MAX_DIMENSION=1920;
export const CAPTURE_MAX_PNG_BYTES=8*1024*1024;
export const CAPTURE_BODY_LIMIT=16*1024*1024;
const id=z.string().min(1).max(200);
export const RoomFollowupIntentSchema=z.strictObject({roomId:id,actionId:id});
export type RoomFollowupIntent=z.infer<typeof RoomFollowupIntentSchema>;
export const CaptureSourceKindSchema=z.enum(['device-camera','virtual-camera']);
export type CaptureSourceKind=z.infer<typeof CaptureSourceKindSchema>;
export const CaptureFrameInputSchema=z.strictObject({
 id,sessionId:id,capturedAt:z.iso.datetime(),
 sourceKind:CaptureSourceKindSchema.optional(),
 roomFollowup:RoomFollowupIntentSchema.optional(),
 imageDataUrl:z.string().max(22+4*Math.ceil(CAPTURE_MAX_PNG_BYTES/3)),
});
export const CaptureImportSchema=z.strictObject({
 importId:id,frames:z.array(CaptureFrameInputSchema).min(1).max(CAPTURE_MAX_FRAMES),
});
export type CaptureFrameInput=z.infer<typeof CaptureFrameInputSchema>;
export type CaptureImport=z.infer<typeof CaptureImportSchema>;
/** Saved source pixels only; no observation or object identity is inferred. */
export interface CapturedFrame {
 id:string;sessionId:string;capturedAt:string;sourceHash:string;
 width:number;height:number;imageUrl:string;analysisStatus:'not-analyzed';
 sourceKind?:CaptureSourceKind;
 roomFollowup?:RoomFollowupIntent;
}
