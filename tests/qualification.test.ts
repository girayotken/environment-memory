import test from 'node:test';
import assert from 'node:assert/strict';
import {reserve,validateNames,type Attempt} from '../scripts/qualification-requests.ts';
import {PNG} from 'pngjs';
import {cropRaster} from '../scripts/qualification-regions.ts';
test('lower-resolution SAM raster maps into source box without resizing source RGB',()=>{
 const source=new PNG({width:6,height:6});for(let i=0;i<36;i++)source.data.set([i,3,4,255],i*4);
 const {crop,pixels}=cropRaster(source,{left:1,top:1,right:5,bottom:5},new Uint8Array([1,0,0,1]),2,2);
 assert.equal(crop.width,4);assert.equal(crop.height,4);assert.equal(pixels.size,8);
 assert.deepEqual([...pixels],[7,8,13,14,21,22,27,28]);
 assert.deepEqual([...crop.data.slice(0,4)],[7,3,4,255]);assert.equal(crop.data[(0*4+3)*4+3],0);
 assert.throws(()=>cropRaster(source,{left:0,top:0,right:7,bottom:4},new Uint8Array(4),2,2));
 assert.throws(()=>cropRaster(source,{left:0,top:0,right:4,bottom:4},new Uint8Array(3),2,2));
});
test('trial keeps failed reservations and refuses retries or cap exhaustion',()=>{
 const failed:Attempt={key:'a',kind:'sam',reservedUsd:.0025,status:'failed'};
 assert.throws(()=>reserve([failed],'b','muse'));
 assert.throws(()=>reserve([{...failed,status:'completed'}],'a','sam'));
 assert.throws(()=>reserve([{...failed,status:'completed',actualUsd:.02}],'b','sam'));
 assert.throws(()=>reserve(Array.from({length:6},(_,i)=>({key:String(i),kind:'muse',reservedUsd:.037888,status:'completed'})),'next','muse'));
 assert.throws(()=>reserve([{key:'a',kind:'sam',reservedUsd:.30,status:'completed'}],'b','sam'));
 assert.equal(reserve([],'first','sam'),.0025);
});
test('crop names cannot omit, duplicate or invent a region association',()=>{
 const r={regionId:'a',label:'tool',appearance:'yellow',uncertainty:'subtype unclear'};
 assert.throws(()=>validateNames({regions:[r,r]},['a','b']));
 assert.throws(()=>validateNames({regions:[r]},['a','b']));
 assert.throws(()=>validateNames({regions:[r]},['b']));
 assert.equal(validateNames({regions:[r]},['a']).regions[0].regionId,'a');
});
