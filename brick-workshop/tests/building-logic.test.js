import test from 'node:test';
import assert from 'node:assert/strict';
import {canPlace,getBounds,getConnections,getAssemblyStats,snapPlacement,validateDocument} from '../src/model.js';

const piece=(id,partId='ld_3005',extra={})=>({id,partId,x:0,y:0,z:0,rotation:0,color:'#515962',...extra});
const placed=(options,parts=[])=>piece('new',options.partId,{...snapPlacement(options,parts)});

test('real bricks and turned plates use the stud grid and real stacking datum',()=>{
  const base=piece('base');
  const upper=placed({partId:'ld_3005',point:{x:.08,y:1.4,z:-.06},normal:[0,1,0],hitPart:base},[base]);
  assert.equal(upper.y,1.2);assert.equal(upper.x,0);assert.equal(upper.z,0);
  assert.equal(canPlace(upper,[base]),true);assert.equal(getConnections([base,upper])[0].studs,1);
  const ground=placed({partId:'ld_3004',rotation:90,point:{x:.2,y:0,z:.2}});
  assert.deepEqual([ground.x,ground.y,ground.z],[0,0,.5]);
});

test('hitting a real stud cylinder wall still stacks along its mating axis',()=>{
  const base=piece('base');
  for(const [point,normal] of [[{x:0,y:1.3,z:.3},[0,0,1]],[{x:.3,y:1.3,z:0},[1,0,0]]]){
    const upper=placed({partId:'ld_3005',point,normal,hitPart:base},[base]);
    assert.deepEqual([upper.x,upper.y,upper.z],[0,1.2,0]);
    assert.equal(canPlace(upper,[base]),true);assert.equal(getConnections([base,upper])[0].studs,1);
  }
  const occupied=piece('occupied','ld_3005',{y:1.2});
  const blocked=placed({partId:'ld_3005',point:{x:0,y:1.3,z:.3},normal:[0,0,1],hitPart:base},[base,occupied]);
  assert.equal(canPlace(blocked,[base,occupied]),false);
});

test('rotated studs and recessed side studs use their connector axis instead of the mesh wall',()=>{
  const rotated=piece('rotated','ld_3005',{rotationZ:90,x:1.4,y:.5});
  const upper=placed({partId:'ld_3005',quaternion:[0,0,Math.SQRT1_2,Math.SQRT1_2],point:{x:.1,y:.8,z:0},normal:[0,1,0],hitPart:rotated},[rotated]);
  assert.deepEqual([upper.x,upper.y,upper.z],[.2,.5,0]);
  assert.equal(canPlace(upper,[rotated]),true);assert.equal(getConnections([rotated,upper])[0].studs,1);
  const headlight=piece('headlight','ld_4070');
  const side=placed({partId:'ld_3024',rotationX:90,point:{x:.3,y:.7,z:.4},normal:[1,0,0],hitPart:headlight},[headlight]);
  assert.deepEqual([side.x,side.y,side.z],[0,.7,.3]);
  assert.equal(canPlace(side,[headlight]),true);assert.equal(getConnections([headlight,side])[0].studs,1);
});

test('a known socket interior wall accepts the normal bottom connection without flipping to another face',()=>{
  const high=piece('high','ld_3005',{y:2});
  const under=placed({partId:'ld_3005',point:{x:.3,y:2.2,z:0},normal:[-1,0,0],hitPart:high},[high]);
  assert.deepEqual([under.x,under.y,under.z],[0,.8,0]);
  assert.equal(canPlace(under,[high]),true);assert.equal(getConnections([under,high])[0].studs,1);
});

test('a large plate uses a nearby bottom connector without jumping its centre to a distant stud',()=>{
  const base=piece('base','ld_3036',{x:.5,z:.5});
  const upper=placed({partId:'ld_3020',point:{x:3.9,y:.6,z:2.9},normal:[0,1,0],hitPart:base},[base]);
  assert.ok(Math.hypot(upper.x-3.9,upper.z-2.9)<.76);
  assert.equal(canPlace(upper,[base]),true);assert.ok(getConnections([base,upper]).length);
});

test('snapping only searches near the actual pointer and avoids an occupied candidate',()=>{
  const base=piece('base','ld_3022',{x:.5,z:.5}),occupied=piece('occupied','ld_3005',{y:.4});
  const upper=placed({partId:'ld_3005',point:{x:.5,y:.6,z:0},normal:[0,1,0],hitPart:base},[base,occupied]);
  assert.deepEqual([upper.x,upper.y,upper.z],[1,.4,0]);assert.equal(canPlace(upper,[base,occupied]),true);
  const far=placed({partId:'ld_3005',point:{x:100,y:1.4,z:0},normal:[0,1,0],hitPart:base},[base]);
  assert.equal(far.x,100);assert.equal(getConnections([base,far]).length,0);
  const farAbove=placed({partId:'ld_3005',point:{x:0,y:100,z:0},normal:[0,1,0],hitPart:base},[base]);
  assert.equal(farAbove.y,100);assert.equal(getConnections([base,farAbove]).length,0);
});

test('plain side contact does not teleport a new brick to the top',()=>{
  const base=piece('base');
  const side=placed({partId:'ld_3005',point:{x:.5,y:.6,z:0},normal:[1,0,0],hitPart:base},[base]);
  assert.deepEqual([side.x,side.y,side.z],[1,0,0]);assert.equal(canPlace(side,[base]),true);
  assert.equal(getConnections([base,side]).length,0);
});

test('4070 accepts a correctly oriented side plate and a high brick accepts underside mating',()=>{
  const headlight=piece('headlight','ld_4070');
  const side=placed({partId:'ld_3024',rotationX:90,point:{x:0,y:.7,z:.5},normal:[0,0,1],hitPart:headlight},[headlight]);
  assert.deepEqual([side.x,side.y,side.z],[0,.7,.3]);assert.equal(canPlace(side,[headlight]),true);
  assert.equal(getConnections([headlight,side])[0].studs,1);
  const high=piece('high','ld_3005',{y:2});
  const under=placed({partId:'ld_3005',point:{x:0,y:2,z:0},normal:[0,-1,0],hitPart:high},[high]);
  assert.deepEqual([under.x,under.y,under.z],[0,.8,0]);assert.equal(canPlace(under,[high]),true);
  assert.equal(getConnections([under,high])[0].studs,1);
});

test('new placement cannot pass solid material through unmatched studs or other studs',()=>{
  const lower=piece('lower');
  assert.equal(canPlace(piece('aligned','ld_3070b',{y:1.2}),[lower]),true);
  assert.equal(canPlace(piece('offset','ld_3070b',{x:.2,y:1.2}),[lower]),false);
  assert.equal(canPlace(piece('upside-down','ld_3005',{rotationX:180,y:2.6}),[lower]),false);
});

test('round corners and the empty space over a slope are available to real pieces',()=>{
  const round=piece('round','ld_98138'),slope=piece('slope','ld_3039');
  assert.equal(canPlace(piece('outside-circle','ld_3024',{x:.9,z:.9}),[round]),true);
  assert.equal(canPlace(piece('inside-circle','ld_3024',{x:.6,z:.6}),[round]),false);
  assert.equal(canPlace(piece('above-front','ld_3024',{z:1.4,y:.6}),[slope]),true);
  assert.equal(canPlace(piece('through-slope','ld_3024',{z:.8,y:.3}),[slope]),false);
});

test('historical nesting can load but cannot bypass collision checks for new edits',()=>{
  const normal=piece('normal'),nested=piece('nested','ld_3005',{allowOverlap:true});
  assert.equal(canPlace(nested,[normal]),false);assert.equal(canPlace(normal,[nested]),false);
  assert.equal(canPlace({...nested,y:.5},[normal]),false);
  assert.equal(canPlace({...nested,y:1.3},[normal]),false);
  assert.equal(canPlace({...nested,y:1.2},[normal]),true);
  assert.equal(validateDocument({version:2,name:'nested',parts:[normal,nested]}).parts.length,2);
  assert.equal(validateDocument({version:2,name:'nested',parts:[nested,normal]}).parts.length,2);
  assert.equal(canPlace({...nested,y:-.1},[normal]),false);
});

test('legacy aliases also block unmatched studs while old stud intersections remain readable',()=>{
  for(const partId of ['ld_3005','brick11']){
    const lower=piece('lower',partId),upper=piece('upper','ld_3024',{y:1.3});
    assert.equal(canPlace(upper,[lower]),false);
    assert.equal(canPlace({...upper,y:1.2},[lower]),true);
    assert.equal(validateDocument({version:2,name:'legacy draft',parts:[lower,upper]}).parts.length,2);
  }
});

test('moving self can be excluded and free placement keeps coordinates without forced connector alignment',()=>{
  const moving=piece('moving'),base=piece('base','ld_3005',{x:5});
  assert.equal(canPlace(moving,[moving],'moving'),true);
  const free=placed({partId:'ld_3005',point:{x:5.13,y:1.4,z:.17},normal:[0,1,0],hitPart:base,snap:false},[base]);
  assert.deepEqual([free.x,free.y,free.z],[5.13,1.4,.17]);assert.equal(getConnections([base,free]).length,0);
});

test('disabling the grid still seats a nearly aligned real socket without quantizing distant free coordinates',()=>{
  const base=piece('base');
  const seated=placed({partId:'ld_3005',point:{x:.03,y:1.4,z:-.04},normal:[0,1,0],hitPart:base,snap:false},[base]);
  assert.deepEqual([seated.x,seated.y,seated.z],[0,1.2,0]);
  assert.equal(canPlace(seated,[base]),true);assert.equal(getConnections([base,seated])[0].studs,1);
  const unaligned=placed({partId:'ld_3005',point:{x:.09,y:1.4,z:0},normal:[0,1,0],hitPart:base,snap:false},[base]);
  assert.deepEqual([unaligned.x,unaligned.y,unaligned.z],[.09,1.4,0]);assert.equal(getConnections([base,unaligned]).length,0);
  const ground=placed({partId:'ld_3005',point:{x:1.23,y:0,z:-.44},snap:false});
  assert.deepEqual([ground.x,ground.y,ground.z],[1.23,0,-.44]);
});

test('flipped pieces use full visual bottoms on placement planes while old nominal-floor drafts still load',()=>{
  const flipped=placed({partId:'ld_3005',rotationX:180,point:{x:0,y:.8,z:0},snap:false});
  assert.equal(getBounds(flipped,true).minY,.8);assert.equal(canPlace(flipped,[]),true);
  const old=piece('old','ld_3005',{rotationX:180,y:1.2});
  assert.equal(validateDocument({version:2,name:'old nominal floor',parts:[old]}).parts.length,1);
  assert.equal(canPlace(old,[]),false);
});

test('assembly grounding uses the visible stud bottom of an inverted real brick',()=>{
  const grounded=piece('grounded','ld_3005',{rotationX:180,y:1.4});
  assert.equal(getBounds(grounded,true).minY,0);
  assert.equal(getAssemblyStats([grounded]).groundedCount,1);
  assert.equal(getAssemblyStats([grounded]).floatingAssemblies,0);
  const floating={...grounded,y:1.5};
  assert.equal(getAssemblyStats([floating]).groundedCount,0);
  assert.equal(getAssemblyStats([floating]).floatingAssemblies,1);
});
