import { Matrix4, Quaternion, Vector3 } from 'three';
import { getPart } from './catalog.js';
import { getBounds, getInstanceMatrix, getLocalBodyBounds, canPlace } from './model.js';

const AXES={x:new Vector3(1,0,0),y:new Vector3(0,1,0),z:new Vector3(0,0,1)};
const clean=n=>Math.abs(n)<1e-10?0:+n.toFixed(8);

export function rotateOrientation(instance,axis) {
  if(!AXES[axis])throw new Error('旋转轴无效');
  const orientation=new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(getInstanceMatrix(instance)));
  orientation.premultiply(new Quaternion().setFromAxisAngle(AXES[axis],Math.PI/2)).normalize();
  if(orientation.w<0)orientation.set(-orientation.x,-orientation.y,-orientation.z,-orientation.w);
  return {rotation:0,rotationX:0,rotationZ:0,quaternion:orientation.toArray().map(clean)};
}

export function rotateInstance(instance,axis) {
  const definition=getPart(instance.partId),bounds=definition.bbox??getLocalBodyBounds(definition);
  const localCenter=new Vector3(...bounds[0]).add(new Vector3(...bounds[1])).multiplyScalar(.5);
  const worldCenter=localCenter.clone().applyMatrix4(new Matrix4().fromArray(getInstanceMatrix(instance)));
  const next={...instance,...rotateOrientation(instance,axis)};
  const rotatedCenter=localCenter.clone().applyQuaternion(new Quaternion().fromArray(next.quaternion));
  const origin=worldCenter.sub(rotatedCenter);next.x=clean(origin.x);next.y=clean(origin.y);next.z=clean(origin.z);
  const oldBottom=getBounds(instance,true).minY,newBottom=getBounds(next,true).minY;
  if(Math.abs(oldBottom)<1e-5||newBottom<0)next.y=clean(next.y-newBottom);
  return next;
}

export function canEditInstance(instance,parts,ignoreId=instance.id) {
  const visual=getBounds(instance,true);
  return visual.minY>=-1e-5 && canPlace(instance,parts,ignoreId);
}
