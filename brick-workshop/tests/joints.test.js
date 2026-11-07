import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, validateDocument, serializeDocument, getBounds, getConnectionPoints, getInstanceMatrix } from '../src/model.js';
import { evaluatePose, validateJointCreation, getJointGroups, getPoseCollisions } from '../src/joints.js';
const p=(id,partId,x,y,z,extra={})=>({id,partId,x,y,z,rotation:0,color:'#515962',...extra});
const pieces=[p('base','ld_3022',.5,0,.5),p('wing','ld_3020',3.5,0,.5),p('cap','ld_3005',3,.4,0)];
const joint={id:'hinge',parentPartId:'base',childPartId:'wing',pivot:[1.5,.4,.5],axis:'z',min:-90,max:90,angleA:0,angleB:90};
test('a custom hinge carries the full child rigid component and returns without drift',()=>{
  const groups=getJointGroups(pieces,[joint]);assert.equal(groups.groups.length,2);
  const a=evaluatePose(pieces,[joint],0),b=evaluatePose(pieces,[joint],1),back=evaluatePose(pieces,[joint],0);
  assert.deepEqual(a.get('base'),b.get('base'));assert.ok(b.get('wing').position[1]>1.9);
  const dist=pose=>Math.hypot(...pose.get('cap').position.map((n,i)=>n-pose.get('wing').position[i]));
  assert.ok(Math.abs(dist(a)-dist(b))<1e-9);assert.deepEqual(a,back);
});
test('same-rigid-group joints, missing part IDs and cycles are rejected',()=>{
  assert.equal(validateJointCreation(pieces,[],{...joint,parentPartId:'wing',childPartId:'cap'}).valid,false);
  assert.equal(validateJointCreation(pieces,[],{...joint,childPartId:'missing'}).valid,false);
  assert.equal(validateJointCreation(pieces,[joint],{...joint,id:'reverse',parentPartId:'wing',childPartId:'base'}).valid,false);
});
test('v1 imports migrate to v2; modules, three-axis rotations and named poses survive save',()=>{
  const old=validateDocument({version:1,name:'旧作品',parts:[p('a','brick11',0,0,0)]});assert.equal(old.version,2);assert.deepEqual(old.joints,[]);
  const doc=validateDocument({...createDocument(),name:'我的折翼',parts:pieces.map(part=>part.id==='base'?{...part,function:{type:'battery',capacity:150}}:part),joints:[joint],poses:[{id:'folded',name:'折叠',angles:{hinge:90}}]});
  assert.deepEqual(validateDocument(serializeDocument(doc)),doc);
  const flipped=p('flipped','ld_3004',0,2,0,{rotationX:90,rotationZ:90});const box=getBounds(flipped);
  assert.ok(box.height>0&&box.width>0);assert.ok(getConnectionPoints(flipped).every(c=>Math.abs(Math.hypot(...c.normal)-1)<1e-6));
});
test('quaternion rest poses normalize and malformed module or pose data do not replace input',()=>{
  const part=p('a','ld_3005',0,2,0,{quaternion:[0,0,0,2]});
  const doc=validateDocument({version:2,name:'空间姿态',parts:[part],joints:[],poses:[]});assert.deepEqual(doc.parts[0].quaternion,[0,0,0,1]);
  assert.deepEqual(getInstanceMatrix(doc.parts[0]).slice(12,15),[0,2,0]);
  assert.throws(()=>validateDocument({...doc,parts:[{...part,function:{type:'fake-power'}}]}));
  assert.throws(()=>validateDocument({...doc,poses:[{id:'p',name:'坏姿态',angles:{missing:5}}]}));
  assert.deepEqual(part.quaternion,[0,0,0,2]);
});
test('mechanical nesting is explicit and conservative pose overlaps are reported',()=>{
  const overlap=[p('one','ld_3005',0,0,0),p('two','ld_3005',0,0,0)];
  assert.throws(()=>validateDocument({version:2,name:'重叠',parts:overlap}));
  const accepted=validateDocument({version:2,name:'手动机械连接',parts:overlap.map(part=>({...part,allowOverlap:true}))});
  assert.equal(accepted.parts.length,2);
  assert.equal(getPoseCollisions(overlap,evaluatePose(overlap)).length,1);
  assert.equal(getPoseCollisions(accepted.parts,evaluatePose(accepted.parts)).length,0);
});
