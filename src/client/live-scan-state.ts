import {CAPTURE_BODY_LIMIT,type CapturedFrame,type CaptureImport} from '../domain/capture-contracts.ts';
export class CaptureHttpError extends Error {constructor(message:string,public readonly status:number){super(message);}}
export const definiteCaptureRejection=(error:unknown)=>error instanceof CaptureHttpError&&error.status>=400&&error.status<500;
export const captureImportFits=(body:CaptureImport)=>new TextEncoder().encode(JSON.stringify(body)).byteLength<=CAPTURE_BODY_LIMIT;
export function captureResponse(data:unknown):{frames:CapturedFrame[]}{
 if(!data||typeof data!=='object'||!('frames' in data)||!Array.isArray(data.frames))throw new Error('The save response was incomplete.');
 for(const frame of data.frames){if(!frame||typeof frame!=='object'||typeof frame.id!=='string'||typeof frame.sessionId!=='string'||typeof frame.capturedAt!=='string'||typeof frame.sourceHash!=='string'||typeof frame.imageUrl!=='string'||typeof frame.width!=='number'||typeof frame.height!=='number'||frame.analysisStatus!=='not-analyzed'||(frame.sourceKind!==undefined&&frame.sourceKind!=='device-camera'&&frame.sourceKind!=='virtual-camera'))throw new Error('The save response was incomplete.');}
 return data as {frames:CapturedFrame[]};
}
