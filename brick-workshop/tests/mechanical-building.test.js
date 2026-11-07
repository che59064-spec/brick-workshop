import test from 'node:test';
import assert from 'node:assert/strict';
import {canPlace,getConnectionPoints,getConnections,snapPlacement} from '../src/model.js';
import {analyzeSupport,checkBuildChange} from '../src/building-support.js';
import {createPlaytest} from '../src/playtest.js';

const piece=(id,partId,extra={})=>({id,partId,x:0,y:0,z:0,rotation:0,color:'#515962',...extra});
const doc=parts=>({version:2,name:'真实销孔装配',parts,joints:[],poses:[]});
const seatedPin=extra=>piece('pin','ld_3673',{rotation:90,y:.3,z:.5,...extra});

test('a real 3673 pin seats in either side of the 3700 hole without collision exemptions',()=>{
  const hole=piece('hole','ld_3700');
  for(const z of [-.5,.5]){
    const pin=seatedPin({z});
    assert.equal(canPlace(pin,[hole]),true);
    assert.deepEqual(getConnections([hole,pin]),[{a:'pin',b:'hole',studs:0,pins:1}]);
    assert.deepEqual([...analyzeSupport([hole,pin]).unsupportedIds],[]);
    assert.equal(checkBuildChange(doc([hole]),doc([hole,pin])).valid,true);
  }
});

test('a real beam hole carries an upright pin and transformed connector metadata remains in world space',()=>{
  const beam=piece('beam','ld_32316'),pin=piece('pin','ld_3673',{rotationZ:90,x:.4,y:1});
  assert.equal(canPlace(pin,[beam]),true);
  assert.equal(getConnections([beam,pin])[0].pins,1);
  assert.equal(checkBuildChange(doc([beam]),doc([beam,pin])).valid,true);
  const segment=getConnectionPoints(pin).find(c=>c.type==='pin'&&c.normal[1]===-1);
  assert.deepEqual(segment.position,[0,.5,0]);assert.equal(segment.length,1);assert.equal(segment.radius,.3);
  const translatedHole=piece('translated','ld_3700',{rotation:90,x:3,y:1,z:-2});
  const quaternionPin=piece('rotated-pin','ld_3673',{quaternion:[0,1,0,0],x:3.5,y:1.3,z:-2});
  assert.equal(canPlace(quaternionPin,[translatedHole]),true);
  assert.equal(getConnections([translatedHole,quaternionPin])[0].pins,1);
});

test('pin snapping uses the real hole entrance to align the engagement centres',()=>{
  const hole=piece('hole','ld_3700');
  for(const snap of [true,false]){
    const pin=piece('pin','ld_3673',snapPlacement({partId:'ld_3673',rotation:90,point:{x:0,y:.7,z:.5},normal:[0,0,1],hitPart:hole,snap},[hole]));
    assert.deepEqual([pin.x,pin.y,pin.z],[0,.3,.5]);assert.equal(canPlace(pin,[hole]),true);
    assert.equal(getConnections([hole,pin])[0].pins,1);
  }
  const pin=seatedPin();
  const around=piece('hole','ld_3700',snapPlacement({partId:'ld_3700',point:{x:0,y:.7,z:-.5},normal:[0,0,-1],hitPart:pin},[pin]));
  assert.deepEqual([around.x,around.y,around.z],[0,0,0]);
  assert.equal(getConnections([pin,around])[0].pins,1);
});

test('friction pins, long pins and only the round end of an axle-pin use their audited segments',()=>{
  const hole=piece('hole','ld_3700');
  for(const [partId,rotation] of [['ld_2780',90],['ld_3673',90],['ld_43093',270],['ld_6558',270]]){
    const pin=piece('pin',partId,snapPlacement({partId,rotation,point:{x:0,y:.7,z:.5},normal:[0,0,1],hitPart:hole},[hole]));
    assert.equal(canPlace(pin,[hole]),true,partId);
    assert.equal(getConnections([hole,pin])[0]?.pins,1,partId);
    assert.equal(checkBuildChange(doc([hole]),doc([hole,pin])).valid,true,partId);
  }
  const axleEnd=piece('axle-end','ld_43093',{rotation:90,y:.3,z:.5125});
  assert.equal(getConnections([hole,axleEnd]).length,0);
});

test('wrong axes, offset pins and an occupied shaft remain rejected',()=>{
  const hole=piece('hole','ld_3700'),pin=seatedPin();
  for(const wrong of [{...pin,x:.08},{...pin,rotation:0}]){
    assert.equal(getConnections([hole,wrong]).length,0);
    assert.equal(canPlace(wrong,[hole]),false);
    assert.equal(checkBuildChange(doc([hole]),doc([hole,wrong])).valid,false);
  }
  const obstacle=piece('obstacle','ld_3005',{z:1.5});
  assert.equal(canPlace(pin,[hole,obstacle]),false);
});

test('pin and hole types never mate with studs, sockets, each other or hinge bearings',()=>{
  const pin=piece('pin','ld_3673',{rotationZ:90,x:.4,y:.7});
  const socket=piece('socket','ld_3005',{y:1.2});
  assert.equal(getConnections([pin,socket]).length,0);
  const stud=piece('stud','ld_3005',{rotationX:90,y:.7,z:-1.2}),hole=piece('hole','ld_3700');
  assert.equal(getConnections([stud,hole]).length,0);
  const second=piece('second','ld_3673',{x:1});
  assert.equal(getConnections([piece('first','ld_3673'),second]).length,0);
  assert.equal(getConnections([hole,{...hole,id:'second-hole'}]).length,0);
  assert.equal(getConnections([piece('female','ld_3937'),piece('male','ld_3938',{y:.4})]).length,0);
});

test('a verified pin connection carries the mounted modules power graph',()=>{
  const hole=piece('battery','ld_3700',{function:{type:'battery',capacity:100}});
  const pin=seatedPin({function:{type:'thruster',power:120}});
  const simulation=createPlaytest(doc([hole,pin]));
  assert.equal(simulation.vehicle.components.length,1);
  assert.equal(simulation.vehicle.batteryCapacity,100);assert.equal(simulation.vehicle.thrusterForce,120);
  assert.deepEqual(simulation.vehicle.disconnectedPartIds,[]);
});
