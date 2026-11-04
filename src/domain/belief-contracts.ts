import {z} from 'zod';

const id=z.string().min(1).max(200),hash=z.string().regex(/^[a-f0-9]{64}$/);
const feature=z.strictObject({method:id,values:z.array(z.number().finite()).min(2).max(128)})
 .refine(f=>Math.abs(Math.hypot(...f.values)-1)<1e-6,'Descriptor must have unit norm');
export const BeliefObservationSchema=z.strictObject({
 id,regionRef:id,cropHash:hash,scope:z.enum(['whole','part','unknown']),feature,
 label:z.string().min(1).max(200).optional(),location:z.string().max(200).optional(),
});
export const BeliefEventSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('observe'),id,provenance:z.enum(['cached-model','live-model','authored-scenario']),
  sourceHash:hash,groupId:id,placeId:id,observedAt:z.iso.datetime(),timeBasis:z.enum(['capture','provider-response','scenario']),
  observations:z.array(BeliefObservationSchema).max(100)}),
 z.strictObject({kind:z.literal('retract'),id,targetId:id,reason:z.string().min(1).max(500)}),
 z.strictObject({kind:z.literal('revise-label'),id,targetObservation:id,label:z.string().min(1).max(200),
  reason:z.string().min(1).max(500)}),
]);
export type BeliefEvent=z.infer<typeof BeliefEventSchema>;
export type BeliefObservation=z.infer<typeof BeliefObservationSchema>;
export type BeliefEpisode=Extract<BeliefEvent,{kind:'observe'}>;

// Engineering assumptions, not fitted likelihoods or measured probabilities.
// Fixed before the replay experiment. Exact enumeration, no hidden beam pruning.
export const BELIEF_MODEL=Object.freeze({version:'belief-replay-v0',calibrated:false,
 descriptorSigma:.15,candidateDistance:.60,matchPrior:.98,newPrior:.015,clutterPrior:.005,
 initialNewPrior:.98,admissionWeight:.95,admissionGap:.20,
 maxComponentObservations:4,maxComponentCandidates:4,maxJointAssignments:4096});
