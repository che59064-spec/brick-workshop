import test from 'node:test';
import assert from 'node:assert/strict';
import {pickStudConnector,pickMechanicalConnector} from '../src/connector-picking.js';

const piece=(id='headlight',partId='ld_4070',extra={})=>({id,partId,x:0,y:0,z:0,rotation:0,color:'#515962',...extra});
const ray={origin:[0,.7,4],direction:[0,0,-1]};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} should equal ${b}`);
const closeVector=(a,b)=>a.forEach((n,i)=>close(n,b[i]));

test('the empty centre and solid rim of a 4070 hollow stud pick the same outer cap',()=>{
  const part=piece(),centre=pickStudConnector({...ray,parts:[part]});
  assert.equal(centre.part,part);closeVector(centre.point,[0,.7,.5]);closeVector(centre.normal,[0,0,1]);close(centre.distance,3.5);
  const rim=pickStudConnector({...ray,origin:[.25,.7,4],parts:[part],meshHitDistance:3.5});
  assert.equal(rim.part,part);closeVector(rim.point,[.25,.7,.5]);
  assert.equal(pickStudConnector({...ray,origin:[.31,.7,4],parts:[part]}),null);
});

test('a nearer solid mesh occludes the virtual cap, but a mesh behind its hole does not',()=>{
  const parts=[piece()];
  assert.equal(pickStudConnector({...ray,parts,meshHitDistance:3.4}),null);
  assert.ok(pickStudConnector({...ray,parts,meshHitDistance:3.6}));
  assert.ok(pickStudConnector({...ray,parts,meshHitDistance:3.5-1e-7}));
  const far=piece('far'),near=piece('near','ld_4070',{z:1});
  const picked=pickStudConnector({...ray,parts:[far,near],meshHitDistance:3});
  assert.equal(picked.part.id,'near');close(picked.distance,2.5);
});

test('caps only accept forward rays from their outward side',()=>{
  const parts=[piece()];
  assert.equal(pickStudConnector({origin:[0,.7,0],direction:[0,0,1],parts}),null);
  assert.equal(pickStudConnector({origin:[0,.7,0],direction:[0,0,-1],parts}),null);
  assert.equal(pickStudConnector({origin:[0,.7,4],direction:[1,0,0],parts}),null);
});

test('translated Euler and Blender quaternion parts expose caps in the correct world direction',()=>{
  const euler=piece('turned','ld_4070',{x:3,y:1,z:-2,rotation:90});
  const quat=piece('quat','ld_4070',{x:3,y:1,z:-2,quaternion:[0,Math.SQRT1_2,0,Math.SQRT1_2]});
  for(const part of [euler,quat]){
    const hit=pickStudConnector({origin:[6,1.7,-2],direction:[-1,0,0],parts:[part]});
    assert.equal(hit.part,part);closeVector(hit.point,[3.5,1.7,-2]);closeVector(hit.normal,[1,0,0]);close(hit.distance,2.5);
  }
  const flipped=piece('down','ld_4070',{x:3,y:2,z:-2,rotationX:90});
  const under=pickStudConnector({origin:[3,0,-1.3],direction:[0,1,0],parts:[flipped]});
  closeVector(under.point,[3,1.5,-1.3]);closeVector(under.normal,[0,-1,0]);
});

test('normalized distances and visible audited connectors are the only picking inputs',()=>{
  const hit=pickStudConnector({...ray,direction:[0,0,-2],parts:[piece()],meshHitDistance:3.6});
  close(hit.distance,3.5);closeVector(hit.point,[0,.7,.5]);
  assert.equal(pickStudConnector({...ray,parts:[piece('hidden','ld_4070',{visible:false})]}),null);
  assert.equal(pickStudConnector({...ray,parts:[piece('beam','ld_32316')]}),null);
  assert.equal(pickStudConnector({...ray,parts:[piece('hole','ld_3700')]}),null);
  assert.equal(pickStudConnector({...ray,parts:[piece('legacy','brick22')]}),null);
  assert.equal(pickStudConnector({...ray,direction:[0,0,0],parts:[piece()]}),null);
  assert.equal(pickStudConnector({...ray,origin:[0,NaN,4],parts:[piece()]}),null);
});

test('verified pin holes pick their real entrance rather than the engagement centre',()=>{
  const hole=piece('hole','ld_3700'),front={origin:[0,.7,4],direction:[0,0,-1],parts:[hole]};
  const hit=pickMechanicalConnector(front);
  assert.equal(hit.part,hole);closeVector(hit.point,[0,.7,.5]);closeVector(hit.connector.position,[0,.7,0]);closeVector(hit.normal,[0,0,1]);
  close(hit.distance,3.5);
  assert.ok(pickMechanicalConnector({...front,origin:[.39,.7,4]}));
  assert.equal(pickMechanicalConnector({...front,origin:[.41,.7,4]}),null);
  const back=pickMechanicalConnector({...front,origin:[0,.7,-4],direction:[0,0,1]});
  closeVector(back.point,[0,.7,-.5]);closeVector(back.normal,[0,0,-1]);
  assert.equal(pickMechanicalConnector({...front,origin:[0,.7,0]}),null);
});

test('pin hole entry disks respect solid occlusion and visibility and select the nearest opening',()=>{
  const hole=piece('hole','ld_3700'),front={origin:[0,.7,4],direction:[0,0,-1],parts:[hole]};
  assert.equal(pickMechanicalConnector({...front,meshHitDistance:3.4}),null);
  assert.ok(pickMechanicalConnector({...front,meshHitDistance:3.6}));
  assert.equal(pickMechanicalConnector({...front,parts:[{...hole,visible:false}]}),null);
  const near=piece('near','ld_3700',{z:1});
  assert.equal(pickMechanicalConnector({...front,parts:[hole,near]}).part,near);
  for(const partId of ['ld_3673','ld_3937','ld_3938','ld_3005'])assert.equal(pickMechanicalConnector({...front,parts:[piece('other',partId)]}),null);
});

test('Euler and quaternion transforms rotate the actual pin-hole entry plane and normal',()=>{
  for(const extra of [{rotation:90},{quaternion:[0,Math.SQRT1_2,0,Math.SQRT1_2]}]){
    const hole=piece('turned','ld_3700',{x:3,y:1,z:-2,...extra});
    const hit=pickMechanicalConnector({origin:[6,1.7,-2],direction:[-1,0,0],parts:[hole]});
    closeVector(hit.point,[3.5,1.7,-2]);closeVector(hit.normal,[1,0,0]);
  }
  const beam=piece('beam','ld_32316');
  const top=pickMechanicalConnector({origin:[0,4,0],direction:[0,-1,0],parts:[beam]});
  closeVector(top.point,[0,1,0]);closeVector(top.normal,[0,1,0]);close(top.distance,3);
});
