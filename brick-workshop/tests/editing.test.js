import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion,Euler,Vector3,Matrix4 } from 'three';
import { rotateInstance,rotateOrientation,canEditInstance } from '../src/editing.js';
import { getBounds,getInstanceMatrix } from '../src/model.js';
import { getPart } from '../src/catalog.js';
const brick=(extra={})=>({id:'a',partId:'ld_3004',x:.5,y:0,z:0,rotation:0,color:'#515962',...extra});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('four world-Y rotations keep a real 1x2 brick at the same position',()=>{
  const original=brick();let current=original;
  for(let i=0;i<4;i++){current=rotateInstance(current,'y');close(current.x,original.x);close(current.y,original.y);close(current.z,original.z);}
  getInstanceMatrix(current).forEach((n,i)=>close(n,getInstanceMatrix(original)[i]));
});
test('four flips stay on the visible floor and return an asymmetric brick without drift',()=>{
  for(const axis of ['x','z']){const original=brick();let current=original;
    for(let i=0;i<4;i++){current=rotateInstance(current,axis);close(getBounds(current,true).minY,0);assert.ok(canEditInstance(current,[]));}
    getInstanceMatrix(current).forEach((n,i)=>close(n,getInstanceMatrix(original)[i]));
  }
});
test('Euler and Blender quaternion pieces follow the same world-axis rotation',()=>{
  const euler=brick({y:3,rotationZ:90}),quaternion={...euler,rotationZ:0,quaternion:new Quaternion().setFromEuler(new Euler(0,0,Math.PI/2)).toArray()};
  const a=rotateInstance(euler,'x'),b=rotateInstance(quaternion,'x');
  getInstanceMatrix(a).forEach((n,i)=>close(n,getInstanceMatrix(b)[i]));
  const orientation=getInstanceMatrix({...brick(),...rotateOrientation(euler,'x')});
  [0,0,1].forEach((n,i)=>close(orientation[i],n));
  [-1,0,0].forEach((n,i)=>close(orientation[4+i],n));
  [0,-1,0].forEach((n,i)=>close(orientation[8+i],n));
});
test('floating pieces rotate about their visible center without stacking another height offset',()=>{
  const original=brick({y:5}),definition=getPart(original.partId),center=new Vector3(...definition.bbox[0]).add(new Vector3(...definition.bbox[1])).multiplyScalar(.5);
  const before=center.clone().applyMatrix4(new Matrix4().fromArray(getInstanceMatrix(original)));
  const rotated=rotateInstance(original,'x'),after=center.clone().applyMatrix4(new Matrix4().fromArray(getInstanceMatrix(rotated)));
  close(before.distanceTo(after),0);
});
test('coordinate editing rejects inverted studs below the floor',()=>{
  const inverted=brick({partId:'ld_3005',rotationX:180,y:1.2});
  assert.ok(getBounds(inverted,true).minY<-.19);assert.equal(canEditInstance(inverted,[]),false);
});
