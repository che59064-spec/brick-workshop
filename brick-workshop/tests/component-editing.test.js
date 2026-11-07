import test from 'node:test';
import assert from 'node:assert/strict';
import {getComponentIds,translateComponent,checkBuildChange} from '../src/building-support.js';
const part=(id,partId,x=0,y=0,z=0,extra={})=>({id,partId,x,y,z,rotation:0,color:'#515962',...extra});
const document=parts=>({version:2,name:'组件移动',parts,joints:[],poses:[]});

test('a grounded real two-part component moves together while single-part movement is blocked',()=>{
  const before=document([part('base','ld_3005'),part('cap','ld_3024',0,1.2),part('other','ld_3005',6)]),snapshot=structuredClone(before);
  const ids=getComponentIds(before,'base');assert.deepEqual([...ids].sort(),['base','cap']);
  const next=translateComponent(before,ids,[3,0,2]);assert.equal(checkBuildChange(before,next).valid,true);
  assert.deepEqual(next.parts.map(p=>[p.id,p.x,p.y,p.z]),[['base',3,0,2],['cap',3,1.2,2],['other',6,0,0]]);
  assert.equal(checkBuildChange(before,translateComponent(before,new Set(['base']),[3,0,2])).valid,false);assert.deepEqual(before,snapshot);
});

test('component preview and placement still reject an occupied destination',()=>{
  const before=document([part('base','ld_3005'),part('cap','ld_3024',0,1.2),part('obstacle','ld_3005',4)]);
  assert.equal(checkBuildChange(before,translateComponent(before,getComponentIds(before,'base'),[4,0,0])).valid,false);
});

test('moving a nearby joint assembly translates its world pivot and preserves modules and poses',()=>{
  const before={...document([part('a','ld_3024',0,0,0,{function:{type:'battery',capacity:77}}),part('b','ld_3024',1)]),joints:[{id:'j',parentPartId:'a',childPartId:'b',pivot:[.5,.4,0],axis:'z',min:-90,max:90,angleA:0,angleB:60}],poses:[{id:'p',name:'折叠',angles:{j:60}}]};
  const next=translateComponent(before,getComponentIds(before,'a'),[3,0,-2]);
  assert.deepEqual(next.joints[0].pivot,[3.5,.4,-2]);assert.deepEqual(next.parts[0].function,before.parts[0].function);assert.deepEqual(next.poses,before.poses);assert.deepEqual(before.joints[0].pivot,[.5,.4,0]);
  assert.equal(checkBuildChange(before,next).valid,true);
});
