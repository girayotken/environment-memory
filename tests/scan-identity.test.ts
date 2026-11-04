import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {identityPairId,projectScanIdentity,validateIdentityCommand,type IdentityAnchor,type IdentityCommand} from '../src/domain/scan-identity.ts';
const anchor=(candidateId:string,sourceHash=candidateId):IdentityAnchor=>({placeId:'p',candidateId,sourceHash:createHash('sha256').update(sourceHash).digest('hex'),observationRef:`o-${candidateId}`,regionRef:`r-${candidateId}`});
const a=anchor('a'),b=anchor('b'),c=anchor('c'),d=anchor('d'),anchors=[a,b,c,d];
const decide=(id:string,left=a,right=b,decision:'same'|'different'|'unsure'='same'):IdentityCommand=>({
 id,placeId:'p',createdAt:'2026-10-28T12:00:00Z',actor:'user',action:{type:'decide',decision,a:left,b:right},
});
const undo=(id:string,decisionId:string):IdentityCommand=>({...decide(id),action:{type:'undo',decisionId}});

test('direct same link preserves exact anchors and all independent input fields',()=>{
 const source={anchors,labels:{a:'Personal label'},tags:{b:['repair']},groups:[['a','c']]};
 const before=structuredClone(source),command=decide('one');
 validateIdentityCommand(command,[],anchors);
 const result=projectScanIdentity(anchors,[command]);
 assert.equal(result.decisions[0].status,'active');assert.equal(result.decisions[0].decision,'same');
 assert.deepEqual(result.decisions[0].a,a);assert.deepEqual(source,before);
 assert.equal(result.decisions.length,1);
});
test('same links reject chains and additional partners but independent links work',()=>{
 const one=decide('one');
 assert.throws(()=>validateIdentityCommand(decide('chain',b,c),[one],anchors),/same partner/);
 assert.throws(()=>validateIdentityCommand(decide('fork',a,c),[one],anchors),/same partner/);
 validateIdentityCommand(decide('independent',c,d),[one],anchors);
 assert.equal(projectScanIdentity(anchors,[one,decide('invalid',b,c)]).decisions[1].status,'stale');
});
test('different and unsure decisions do not propagate to other pairs',()=>{
 const history=[decide('one',a,b,'different'),decide('two',b,c,'unsure'),decide('three',a,c)];
 assert.deepEqual(projectScanIdentity(anchors,history).decisions.map(d=>d.status),['active','active','active']);
 assert.equal(projectScanIdentity(anchors,history).decisions.length,3);
 assert.throws(()=>validateIdentityCommand(decide('repeat',b,a),history,anchors),/already has an active decision/);
});
test('reversed pair retry is idempotent; changed command content collides',()=>{
 const one=decide('one'),reverse=decide('one',b,a);
 assert.equal(identityPairId(a,b),identityPairId(b,a));
 validateIdentityCommand(reverse,[one],anchors);
 assert.equal(projectScanIdentity(anchors,[one,reverse]).decisions.length,1);
 assert.throws(()=>validateIdentityCommand(decide('one',b,a,'different'),[one],anchors),/ID collision/);
 assert.throws(()=>projectScanIdentity(anchors,[one,{...one,createdAt:'2026-10-28T13:00:00Z'}]),/ID collision/);
});
test('undo retains originals and frees direct partner for a new decision',()=>{
 const one=decide('one'),withdraw=undo('u','one'),replacement=decide('next',b,c);
 validateIdentityCommand(withdraw,[one],anchors);validateIdentityCommand(replacement,[one,withdraw],anchors);
 const result=projectScanIdentity(anchors,[one,withdraw,replacement]);
 assert.deepEqual(result.decisions.map(d=>[d.id,d.status]),[['one','undone'],['next','active']]);
 assert.deepEqual(one,decide('one'));
 assert.throws(()=>validateIdentityCommand(undo('again','one'),[one,withdraw],anchors),/prior non-withdrawn/);
 assert.throws(()=>validateIdentityCommand(undo('nested','u'),[one,withdraw],anchors),/prior non-withdrawn/);
});
test('missing or changed evidence makes decisions stale; stale decision can still be undone',()=>{
 const one=decide('one'),changed=[a,{...b,sourceHash:'f'.repeat(64)}];
 assert.equal(projectScanIdentity([a],[one]).decisions[0].status,'stale');
 assert.equal(projectScanIdentity(changed,[one]).decisions[0].status,'stale');
 assert.throws(()=>validateIdentityCommand(one,[],changed),/absent or changed/);
 validateIdentityCommand(one,[one],[]);
 validateIdentityCommand(undo('u','one'),[one],[]);
 assert.equal(projectScanIdentity([],[one,undo('u','one')]).decisions[0].status,'undone');
});
test('same source, same candidate and unrelated command places are forbidden',()=>{
 assert.throws(()=>validateIdentityCommand(decide('x',a,{...b,sourceHash:a.sourceHash}),[],anchors),/different saved sources/);
 assert.throws(()=>validateIdentityCommand(decide('x',a,{...b,candidateId:'a'}),[],anchors),/distinct candidates/);
 assert.throws(()=>validateIdentityCommand({...decide('x'),placeId:'unrelated'},[],anchors),/command place/);
});

test('cross-place links and undo from either endpoint place work without candidate collisions',()=>{
 const other={...b,placeId:'other',candidateId:'a'};
 const current=[a,other,c];
 const one=decide('cross',a,other);
 validateIdentityCommand(one,[],current);
 assert.equal(projectScanIdentity(current,[one]).decisions[0].status,'active');
 validateIdentityCommand(decide('cross',other,a),[one],current);
 validateIdentityCommand({...undo('u','cross'),placeId:'other'},[one],current);
 assert.throws(()=>validateIdentityCommand({...undo('bad','cross'),placeId:'third'},[one],current),/prior non-withdrawn/);
 assert.throws(()=>validateIdentityCommand(decide('chain',other,c),[one],current),/same partner/);
});

test('withdrawn links never revive when their exact saved sources return',()=>{
 const one=decide('one'),commands=[one,undo('u','one')];
 assert.equal(projectScanIdentity([a],commands).decisions[0].status,'undone');
 const restored=projectScanIdentity(anchors,commands);
 assert.equal(restored.decisions[0].status,'undone');
 validateIdentityCommand(decide('new',b,c),commands,anchors);
});
test('different and unsure each leave both candidates free for same partners',()=>{
 for(const decision of ['different','unsure'] as const){
  const prior=[decide('comparison',a,b,decision)];
  validateIdentityCommand(decide('a-partner',a,c),prior,anchors);
  validateIdentityCommand(decide('b-partner',b,d),prior,anchors);
  assert.deepEqual(projectScanIdentity(anchors,[...prior,decide('a-partner',a,c),decide('b-partner',b,d)]).decisions.map(d=>d.status),['active','active','active']);
 }
});
test('identity schema bounds references and requires a real source hash',()=>{
 assert.throws(()=>validateIdentityCommand({...decide('x'),id:'x'.repeat(201)},[],anchors));
 assert.throws(()=>validateIdentityCommand(decide('x',{...a,observationRef:'o'.repeat(1001)},b),[],anchors));
 assert.throws(()=>validateIdentityCommand(decide('x',{...a,sourceHash:'short'},b),[],anchors));
});
