import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {RoomMemory} from '../src/domain/room-memory-contracts.ts';
import {ContainmentAnswer} from '../src/client/RoomContainment.tsx';

test('storage answer separates the user record from the box sighting and disappears after removal',()=>{
 const room={roomId:'room',label:'Room',graph:{nodes:[{id:'box',label:'Camera box',kind:'container',attributes:[],evidence:[]}],sourceViews:[],edges:[],identityGroups:[]},visits:[],containment:{revision:1,events:[],active:[{itemId:'charger',containerId:'box',recordedAt:'2026-10-01T10:00:00Z',statement:'I put it in',source:{imageUrl:'/item.png'},containerLastSeen:{location:'Hall shelf',capturedAt:'2026-11-01T10:00:00Z',source:{imageUrl:'/box.png'},identityMatch:'probable'}}]}} as unknown as RoomMemory;
 const render=()=>renderToStaticMarkup(createElement(ContainmentAnswer,{room,itemId:'charger'}));
 const html=render();for(const value of ['Camera box','Recorded by you','2026-10-01T10:00:00Z','Hall shelf','2026-11-01T10:00:00Z','Probably the same box','/box.png'])assert.ok(html.includes(value),value);
 room.containment!.active=[];assert.equal(render(),'');
});

 test('removal wording distinguishes whether a later sighting exists',async()=>{
 const {RemovalNotice}=await import('../src/client/AskMemory.tsx');
 const removal={containerLabel:'Camera box',recordedAt:'2026-10-01T10:00:00Z',itemSeenAfterRemoval:false};
 const render=()=>renderToStaticMarkup(createElement(RemovalNotice,{removal}));
 assert.match(render(),/No later location recorded/);
 removal.itemSeenAfterRemoval=true;
 const later=render();assert.match(later,/A later sighting is shown below/);assert.doesNotMatch(later,/No later location recorded/);
 });

test('image suggestions are dated and offer correction without claiming removal',async()=>{
 const {RoomContainment}=await import('../src/client/RoomContainment.tsx');
 const room={roomId:'room',label:'Room',graph:{nodes:[{id:'box',label:'Camera box',kind:'container',attributes:[],evidence:[]}],sourceViews:[],edges:[],identityGroups:[]},visits:[],containment:{revision:1,events:[],active:[{itemId:'charger',containerId:'box',attribution:'model',recordedAt:'2026-10-02T10:00:00Z',statement:'Visible inside',source:{imageUrl:'/item.png',capturedAt:'2026-10-01T10:00:00Z'},containerLastSeen:null}]}} as unknown as RoomMemory;
 const html=renderToStaticMarkup(createElement(ContainmentAnswer,{room,itemId:'charger'}));
 assert.match(html,/Possibly in/);assert.match(html,/Suggested from image/);assert.match(html,/2026-10-01T10:00:00Z/);assert.match(html,/\/item.png/);assert.doesNotMatch(html,/Recorded by you/);
 const controls=renderToStaticMarkup(createElement(RoomContainment,{room,itemId:'charger',locked:false,onUpdate:()=>{},onBusy:()=>{}}));
 assert.match(controls,/This suggestion is wrong/);assert.match(controls,/Correct container/);assert.match(controls,/Save correction/);assert.match(controls,/I took this out/);
});


test('live row indicates only image-suggested containment',async()=>{
 const {LiveContainerSuggestion}=await import('../src/client/RoomContainment.tsx');
 const room={containment:{active:[{itemId:'item',attribution:'model'}]}} as unknown as RoomMemory;
 const render=(nodeId:string)=>renderToStaticMarkup(createElement(LiveContainerSuggestion,{room,nodeId}));
 assert.match(render('item'),/Suggested container/);assert.equal(render('other'),'');
 room.containment!.active[0].attribution='user';assert.equal(render('item'),'');
});

test('outside evidence has its own dated source and can be corrected',async()=>{
 const {OutsideNotice,RoomContainment,LiveContainerSuggestion}=await import('../src/client/RoomContainment.tsx');
 const evidence={operationId:'outside-1',containerId:'box',containerLabel:'Camera box',recordedAt:'2026-11-02T12:00:00Z',source:{imageUrl:'/outside.png',capturedAt:'2026-11-02T11:00:00Z'},statement:'Visible beside the box',attribution:'model' as const};
 const html=renderToStaticMarkup(createElement(OutsideNotice,{evidence}));
 for(const text of ['Seen outside','Camera box','2026-11-02T11:00:00Z','/outside.png','Visible beside the box'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Removed from|Possibly in/);
 const room={roomId:'room',label:'Room',graph:{nodes:[{id:'box',label:'Camera box',kind:'container',attributes:[],evidence:[]},{id:'item',label:'Charger',kind:'portable',attributes:[],evidence:[]}],sourceViews:[],edges:[],identityGroups:[]},visits:[],containment:{revision:2,active:[],events:[{...evidence,itemId:'item',action:'outside',withdrawn:false}]}} as unknown as RoomMemory;
 const controls=renderToStaticMarkup(createElement(RoomContainment,{room,itemId:'item',locked:false,onUpdate:()=>{},onBusy:()=>{}}));
 assert.match(controls,/This outside suggestion is wrong/);assert.doesNotMatch(controls,/Possibly in|I took this out/);
 assert.equal(renderToStaticMarkup(createElement(LiveContainerSuggestion,{room,nodeId:'item'})),'');
});
