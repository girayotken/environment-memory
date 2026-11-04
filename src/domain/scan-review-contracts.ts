import type {BeliefProjection} from './belief-memory.ts';
import type {BeliefEpisode,BeliefObservation} from './belief-contracts.ts';
import type {ScanClaimsProjection} from './scan-claims.ts';
import type {ScanSession} from './scan-contracts.ts';
export interface ScanReviewPlace {id:string;label:string;candidateCount:number;sessionCount:number}
export interface ScanReviewCard {
 candidateId:string;observationRef:string;regionRef:string;cropUrl:string;sourceUrl:string;
 sourceHash:string;cropHash:string;observedAt:string;timeBasis:BeliefEpisode['timeBasis'];
 scope:BeliefObservation['scope'];modelLabel:string|null;
 bounds:{left:number;top:number;right:number;bottom:number};sourceWidth:number;sourceHeight:number;
}
export interface ScanReviewView {
 revision:number;latestRevision:number;sessions:ScanSession[];belief:BeliefProjection;claims:ScanClaimsProjection;cards:ScanReviewCard[];
}
