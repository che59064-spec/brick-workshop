import { PARTS, getPart, getFootprint } from './catalog.js';
import { validateJoints } from './joints.js';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

const EPS = 1e-5, LIMIT = 200, MAX_PARTS = 1000;
const ROTATIONS = [0, 90, 180, 270];
const FUNCTION_TYPES = new Set(['battery', 'thruster', 'wheel', 'servo']);
const clean = n => +n.toFixed(6);
const near = (a, b) => Math.abs(a - b) < EPS;
const finite = n => typeof n === 'number' && Number.isFinite(n);

export function createDocument(name = '未命名作品') { return { version: 2, name, parts: [], joints: [], poses: [] }; }

function validPosition(p) {
  return p && getPart(p.partId) && ROTATIONS.includes(p.rotation) && ROTATIONS.includes(p.rotationX ?? 0) && ROTATIONS.includes(p.rotationZ ?? 0)
    && (p.quaternion === undefined || (Array.isArray(p.quaternion) && p.quaternion.length === 4 && p.quaternion.every(finite) && Math.hypot(...p.quaternion) > EPS))
    && ['x', 'y', 'z'].every(k => finite(p[k])) && Math.abs(p.x) <= LIMIT && Math.abs(p.z) <= LIMIT && p.y >= -EPS && p.y <= LIMIT;
}

/** Three.js-compatible column-major matrix, XYZ Euler order; saved angles are degrees. */
export function getInstanceMatrix(p) {
  if (p.quaternion) {
    const length = Math.hypot(...p.quaternion), [x, y, z, w] = p.quaternion.map(n => n / length);
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      p.x, p.y, p.z, 1].map(n => Math.abs(n) < 1e-12 ? 0 : n);
  }
  const x = (p.rotationX ?? 0) * Math.PI / 180, y = p.rotation * Math.PI / 180, z = (p.rotationZ ?? 0) * Math.PI / 180;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [c * e, a * f + b * d * e, b * f - a * d * e, 0, -c * f, a * e - b * d * f, b * e + a * d * f, 0, d, -b * c, a * c, 0, p.x, p.y, p.z, 1].map(n => Math.abs(n) < 1e-12 ? 0 : n);
}

export function transformPoint3(m, p) { return [0, 1, 2].map(i => clean(m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i])); }

export function getLocalBodyBounds(partOrId) {
  const p = typeof partOrId === 'string' ? getPart(partOrId) : partOrId;
  if (!p) throw new Error('未知零件');
  return p.bodyBounds ?? [[-p.width / 2, 0, -p.depth / 2], [p.width / 2, p.height, p.depth / 2]];
}

export function getBounds(instance, includeStuds = false) {
  const definition = getPart(instance.partId);
  const [min, max] = includeStuds && definition.bbox ? definition.bbox : getLocalBodyBounds(instance.partId), m = getInstanceMatrix(instance);
  const corners = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => transformPoint3(m, [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]]))));
  const lo = [0, 1, 2].map(i => clean(Math.min(...corners.map(p => p[i])))), hi = [0, 1, 2].map(i => clean(Math.max(...corners.map(p => p[i]))));
  return { minX: lo[0], maxX: hi[0], minY: lo[1], maxY: hi[1], minZ: lo[2], maxZ: hi[2], width: clean(hi[0] - lo[0]), depth: clean(hi[2] - lo[2]), height: clean(hi[1] - lo[1]) };
}

const dot3 = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const rectangle = (x, z, xx, zz) => [[x,z],[xx,z],[xx,zz],[x,zz]];
const extrude = (polygon, bottom, top) => [bottom,top].flatMap(y=>polygon.map(([x,z])=>[x,y,z]));
const boxVertices = ([min,max]) => [0,1].flatMap(x=>[0,1].flatMap(y=>[0,1].map(z=>[x?max[0]:min[0],y?max[1]:min[1],z?max[2]:min[2]])));
function uniqueDirections(directions) {
  const result=[],seen=new Set();
  for(const value of directions){
    const length=Math.hypot(...value); if(length<EPS)continue;
    let axis=value.map(n=>n/length);if((axis.find(n=>Math.abs(n)>EPS)??1)<0)axis=axis.map(n=>-n);
    const key=axis.map(n=>Math.round(n*1e6)).join(',');if(!seen.has(key)){seen.add(key);result.push(axis);}
  }
  return result;
}
function compileHull(vertices) {
  const hull=new ConvexHull().setFromPoints(vertices.map(p=>new Vector3(...p))),normals=[],edges=[];
  for(const face of hull.faces){
    normals.push(face.normal.toArray());let edge=face.edge;
    do{const a=edge.head().point,b=edge.tail().point;edges.push([a.x-b.x,a.y-b.y,a.z-b.z]);edge=edge.next;}while(edge!==face.edge);
  }
  return {vertices,normals:uniqueDirections(normals),edges:uniqueDirections(edges)};
}
const bodyProfiles=new WeakMap(),worldProfiles=new WeakMap(),studProfiles=new Map();
function localBodies(definition) {
  if(bodyProfiles.has(definition))return bodyProfiles.get(definition);
  let profiles=definition.collisionHulls;
  if(!profiles){
    if(definition.polygon)profiles=[extrude(definition.polygon,0,definition.height)];
    else if(definition.shape==='lbeam')profiles=getFootprint(definition).map(([x,z])=>extrude(rectangle(x-definition.width/2,z-definition.depth/2,x-definition.width/2+1,z-definition.depth/2+1),0,definition.height));
    else if(definition.shape==='round')profiles=[extrude(Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8)*definition.width/2,Math.sin(i*Math.PI/8)*definition.depth/2]),0,definition.height)];
    else profiles=[boxVertices(getLocalBodyBounds(definition))];
  }
  const result=profiles.map(compileHull);bodyProfiles.set(definition,result);return result;
}
function transformedHull(hull,matrix) {
  const rotate=value=>[0,1,2].map(i=>matrix[i]*value[0]+matrix[4+i]*value[1]+matrix[8+i]*value[2]);
  const vertices=hull.vertices.map(p=>transformPoint3(matrix,p));
  return {vertices,normals:hull.normals.map(rotate),edges:hull.edges.map(rotate),min:[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i])))};
}
function boundsOverlap(a,b){return [0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>EPS);}
function hullsOverlap(a,b){
  if(!boundsOverlap(a,b))return false;
  const axes=[...a.normals,...b.normals,...a.edges.flatMap(x=>b.edges.map(y=>cross3(x,y)))];
  for(const axis of axes){
    const length=Math.hypot(...axis);if(length<EPS)continue;
    const pa=a.vertices.map(p=>dot3(p,axis)),pb=b.vertices.map(p=>dot3(p,axis));
    if(Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb))<=EPS*length)return false;
  }
  return true;
}
function collisionData(instance,includeStuds){
  const definition=getPart(instance.partId),matrix=getInstanceMatrix(instance),key=matrix.join(',');
  const cached=worldProfiles.get(instance),reuse=cached?.definition===definition&&cached.key===key;
  if(reuse&&(!includeStuds||cached.studs!==null))return cached;
  const bodies=reuse?cached.bodies:localBodies(definition).map(h=>transformedHull(h,matrix));
  const connectors=includeStuds?getConnectionPoints(instance):null;
  const studs=!includeStuds?null:connectors.filter(c=>c.type==='stud').map(c=>{
    const normal=c.normal,helper=Math.abs(normal[1])<.9?[0,1,0]:[1,0,0],u=cross3(normal,helper),length=Math.hypot(...u),axis=u.map(n=>n/length),v=cross3(axis,normal),height=definition.studHeight||.2;
    if(!studProfiles.has(height))studProfiles.set(height,compileHull([0,height].flatMap(y=>Array.from({length:16},(_,i)=>[.3*Math.cos(i*Math.PI/8),y,.3*Math.sin(i*Math.PI/8)]))));
    const matrix=[...axis,0,...normal,0,...v,0,...c.position,1];
    return {...transformedHull(studProfiles.get(height),matrix),position:c.position,normal};
  });
  const data={definition,key,bodies,studs,connectors};worldProfiles.set(instance,data);return data;
}
export function instancesOverlap(a,b,includeStuds=true){
  // Saved drafts retain historical nesting; new edits always check solid geometry.
  if(!includeStuds&&(a.allowOverlap||b.allowOverlap))return false;
  const aa=collisionData(a,includeStuds),bb=collisionData(b,includeStuds);
  if(aa.bodies.some(x=>bb.bodies.some(y=>hullsOverlap(x,y))))return true;
  if(!includeStuds)return false;
  const studHitsBody=(studs,other)=>studs.some(stud=>{
    const mate=other.connectors.some(socket=>socket.type==='socket'&&dot3(stud.normal,socket.normal)<-.999&&distance2(stud.position,socket.position)<EPS**2);
    return !mate&&other.bodies.some(body=>hullsOverlap(stud,body));
  });
  return studHitsBody(aa.studs,bb)||studHitsBody(bb.studs,aa)||aa.studs.some(x=>bb.studs.some(y=>hullsOverlap(x,y)));
}

function insideBounds(p,visual=false) {
  if(!validPosition(p))return false;
  const b=getBounds(p,visual);
  return b.minY>=-EPS&&b.maxY<=LIMIT+EPS&&(!visual||[b.minX,b.minZ].every(n=>n>=-LIMIT-EPS)&&[b.maxX,b.maxZ].every(n=>n<=LIMIT+EPS));
}
export function canPlace(instance,parts=[],ignoreId){return insideBounds(instance,true)&&!parts.some(p=>p.id!==ignoreId&&instancesOverlap(instance,p));}

function localConnectors(part) {
  if (Array.isArray(part.connectors)) return part.connectors;
  return getFootprint(part).flatMap(([ix, iz]) => {
    const x = ix - (part.width - 1) / 2, z = iz - (part.depth - 1) / 2;
    return [...(part.studs ? [{ type: 'stud', position: [x, part.height, z], normal: [0, 1, 0] }] : []), { type: 'socket', position: [x, 0, z], normal: [0, -1, 0] }];
  });
}

/** Known connector positions and normals transform together; mechanical interfaces are not guessed from a box. */
export function getConnectionPoints(instance) {
  const m = getInstanceMatrix(instance);
  const definition=getPart(instance.partId);
  return [...localConnectors(definition),...(definition.mechanicalConnectors??[])].map(c => ({ ...c, position: transformPoint3(m, c.position), normal: [0, 1, 2].map(i => clean(m[i] * c.normal[0] + m[4 + i] * c.normal[1] + m[8 + i] * c.normal[2])) }));
}

const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const distance2 = (a, b) => a.reduce((sum, n, i) => sum + (n - b[i]) ** 2, 0);
const MATES={stud:'socket',socket:'stud',pin:'pin-hole','pin-hole':'pin'};
const compatible=(a,b)=>MATES[a.type]===b.type&&dot(a.normal,b.normal)<-.999;
export function snapPlacement({ partId, rotation = 0, rotationX = 0, rotationZ = 0, quaternion, point, hitPart, snap = true, normal, ignoreId, allowOverlap = false }, parts = []) {
  if (!getPart(partId)) throw new Error('未知零件');
  const orientation = { partId, rotation, rotationX, rotationZ, quaternion, x: 0, y: 0, z: 0 };
  const angles = { rotation, ...(rotationX ? { rotationX } : {}), ...(rotationZ ? { rotationZ } : {}), ...(quaternion ? { quaternion: [...quaternion] } : {}) };
  const result = (x, y, z) => ({ partId, ...angles, x: clean(x), y: clean(y), z: clean(z) });
  const bounds=getBounds(orientation),visual=getBounds(orientation,true);
  const offsetX=near(bounds.width,Math.round(bounds.width))&&Math.round(bounds.width)%2===0?.5:0;
  const offsetZ=near(bounds.depth,Math.round(bounds.depth))&&Math.round(bounds.depth)%2===0?.5:0;
  const centre=[(bounds.minX+bounds.maxX)/2,(bounds.minY+bounds.maxY)/2,(bounds.minZ+bounds.maxZ)/2];
  const source=[point.x,point.y,point.z],direction=normal??[0,1,0],length=Math.hypot(...direction)||1,n=direction.map(v=>v/length);
  if(hitPart&&!normal)source[1]=getBounds(hitPart).maxY;
  const surfacePosition=axisNormal=>{
    let position;
    if(hitPart){
      const projection=dot3(centre,axisNormal),support=Math.min(...boxVertices([[visual.minX,visual.minY,visual.minZ],[visual.maxX,visual.maxY,visual.maxZ]]).map(p=>dot3(p,axisNormal)));
      position=source.map((v,i)=>v-centre[i]+axisNormal[i]*(projection-support));
    }else position=[source[0]-centre[0],Math.max(0,source[1])-visual.minY,source[2]-centre[2]];
    if(snap){
      const axis=axisNormal.findIndex(value=>Math.abs(value)>.999);
      if(!hitPart||axis===1){position[0]=Math.round(position[0]+centre[0]-offsetX)+offsetX-centre[0];position[2]=Math.round(position[2]+centre[2]-offsetZ)+offsetZ-centre[2];}
      else if(axis===0){position[1]=Math.round(position[1]/.4)*.4;position[2]=Math.round(position[2]+centre[2]-offsetZ)+offsetZ-centre[2];}
      else if(axis===2){position[0]=Math.round(position[0]+centre[0]-offsetX)+offsetX-centre[0];position[1]=Math.round(position[1]/.4)*.4;}
    }
    return position;
  };
  const position=surfacePosition(n);
  if (hitPart) {
    const moving=getConnectionPoints(orientation);
    const snapRadius=snap?.76:.08;
    const tangentDistance=(a,b,axis)=>{const delta=a.map((v,i)=>v-b[i]),normalDistance=dot3(delta,axis);return Math.max(0,dot3(delta,delta)-normalDistance**2);};
    const target=getConnectionPoints(hitPart).filter(c=>{
      if(dot(c.normal,n)>.95)return true;
      // Stud sides and socket interiors have mesh normals different from their mating axis.
      const axial=dot3(source.map((v,i)=>v-c.position[i]),c.normal);
      const mechanical=c.type==='pin'||c.type==='pin-hole';
      const withinDepth=mechanical?Math.abs(axial)<=(c.length??1)/2+.03:c.type==='stud'?axial>=-EPS&&axial<=(getPart(hitPart.partId).studHeight||.2)+.03:c.type==='socket'&&axial>=-.8&&axial<=EPS;
      return withinDepth&&dot(c.normal,n)>-.05&&tangentDistance(c.position,source,c.normal)<=(mechanical?.43:.33)**2;
    });
    const colliders=parts.some(p=>p.id===hitPart.id)?parts:[...parts,hitPart];
    let best = null, score = Infinity;
    for(const b of target){
      if(tangentDistance(b.position,source,b.normal)>snapRadius**2||distance2(b.position,source)>.8**2)continue;
      const intent=surfacePosition(b.normal),mates=moving.filter(a=>compatible(a,b));
      const anchorDistance=a=>tangentDistance(a.position.map((v,i)=>v+intent[i]),source,b.normal);
      const nearestAnchor=Math.min(...mates.map(anchorDistance));
      for(const a of mates){
        if(anchorDistance(a)>nearestAnchor+EPS)continue;
        const candidate=b.position.map((value,i)=>value-a.position[i]);
        if(tangentDistance(candidate,intent,b.normal)>snapRadius**2||!canPlace({...orientation,...result(...candidate),allowOverlap},colliders,ignoreId))continue;
        const current=tangentDistance(b.position,source,b.normal)+tangentDistance(candidate,intent,b.normal)*.05;
        if(current<score){best=candidate;score=current;}
      }
    }
    if (best) return result(...best);
  }
  return result(...position);
}

export function getConnections(parts) {
  const points = parts.map(getConnectionPoints), result = [];
  const matches = (a, b, type) => a.filter(connector => connector.type === type && b.some(mate => compatible(connector,mate)&&distance2(connector.position,mate.position)<EPS**2)).length;
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const forward=matches(points[i],points[j],'stud'),pins=matches(points[i],points[j],'pin');
    if(forward||pins)result.push({a:parts[i].id,b:parts[j].id,studs:forward,...(pins?{pins}:{})});
    else {const reverse=matches(points[j],points[i],'stud'),reversePins=matches(points[j],points[i],'pin');if(reverse||reversePins)result.push({a:parts[j].id,b:parts[i].id,studs:reverse,...(reversePins?{pins:reversePins}:{})});}
  }
  return result;
}

export function getAssemblyStats(parts) {
  const connections = getConnections(parts), parents = new Map(parts.map(p => [p.id, p.id]));
  const find = id => { while (parents.get(id) !== id) { parents.set(id, parents.get(parents.get(id))); id = parents.get(id); } return id; };
  for (const { a, b } of connections) parents.set(find(a), find(b));
  const groups = new Set(parts.map(p => find(p.id))), grounded = parts.filter(p => near(getBounds(p,true).minY, 0)), groundGroups = new Set(grounded.map(p => find(p.id)));
  return { count: parts.length, weight: clean(parts.reduce((sum, p) => sum + getPart(p.partId).weight, 0)), assemblies: groups.size, connections: connections.length, groundedCount: grounded.length, floatingAssemblies: [...groups].filter(id => !groundGroups.has(id)).length };
}

function validateFunction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !FUNCTION_TYPES.has(value.type)) throw new Error('功能模块类型无效');
  const out = { type: value.type };
  for (const key of ['power', 'capacity']) if (value[key] !== undefined) {
    if (!finite(value[key]) || value[key] < 0 || value[key] > 1e9) throw new Error('功能模块参数必须为有限非负数字');
    out[key] = value[key];
  }
  return out;
}

export function validateDocument(raw) {
  if (typeof raw === 'string') { if (raw.length > 2_000_000) throw new Error('作品文件过大'); try { raw = JSON.parse(raw); } catch { throw new Error('作品文件不是有效的 JSON'); } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![1, 2].includes(raw.version)) throw new Error('不支持的作品格式或版本');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) throw new Error('作品名称须为 1–80 个字符');
  if (!Array.isArray(raw.parts) || raw.parts.length > MAX_PARTS) throw new Error(`作品最多支持 ${MAX_PARTS} 个零件`);
  const parts = [], ids = new Set();
  for (let i = 0; i < raw.parts.length; i++) {
    const value = raw.parts[i];
    if (!validPosition(value)) throw new Error(`第 ${i + 1} 个零件的类型、坐标或角度无效`);
    if (typeof value.id !== 'string' || !value.id || value.id.length > 100 || ids.has(value.id)) throw new Error('零件 ID 缺失或重复');
    if (typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)) throw new Error('零件颜色必须是有效的十六进制颜色');
    if (value.allowOverlap !== undefined && typeof value.allowOverlap !== 'boolean') throw new Error('机械嵌套选项必须为布尔值');
    const instance = { id: value.id, partId: value.partId, x: clean(value.x), y: clean(Math.max(0, value.y)), z: clean(value.z), rotation: value.rotation, rotationX: value.rotationX ?? 0, rotationZ: value.rotationZ ?? 0, color: value.color.toLowerCase(), ...(value.allowOverlap !== undefined ? { allowOverlap: value.allowOverlap } : {}), ...(value.function !== undefined ? { function: validateFunction(value.function) } : {}) };
    if (value.quaternion) { const length = Math.hypot(...value.quaternion); instance.quaternion = value.quaternion.map(n => n / length); }
    // Existing drafts keep their original nominal floor/stud tolerance; new editing uses canPlace's visual bounds and stud tests.
    if (!insideBounds(instance) || parts.some(p=>instancesOverlap(instance,p,false))) throw new Error(`第 ${i + 1} 个零件与已有零件重叠或超出工作范围`);
    parts.push(instance); ids.add(instance.id);
  }
  const joints = validateJoints(parts, raw.joints ?? []);
  if (!Array.isArray(raw.poses ?? []) || (raw.poses?.length ?? 0) > 100) throw new Error('姿态列表无效');
  const jointById = new Map(joints.map(j => [j.id, j])), poseIds = new Set();
  const poses = (raw.poses ?? []).map(pose => {
    if (!pose || typeof pose.id !== 'string' || !pose.id || pose.id.length > 100 || poseIds.has(pose.id) || typeof pose.name !== 'string' || !pose.name.trim() || pose.name.length > 80 || !pose.angles || typeof pose.angles !== 'object' || Array.isArray(pose.angles)) throw new Error('姿态名称、ID 或角度列表无效');
    poseIds.add(pose.id);
    const angles = {};
    for (const [id, angle] of Object.entries(pose.angles)) { const joint = jointById.get(id); if (!joint || !finite(angle) || angle < joint.min || angle > joint.max) throw new Error('姿态引用未知关节，或角度超出限位'); Object.defineProperty(angles, id, { value: angle, enumerable: true, writable: true, configurable: true }); }
    return { id: pose.id, name: pose.name.trim(), angles };
  });
  return { version: 2, name: raw.name.trim(), parts, joints, poses };
}

export function serializeDocument(doc) { return JSON.stringify(validateDocument(doc), null, 2); }

export function createExample() {
  const definitions = [
    ['plate28', 0.5, 0, 0.5, 0, '#515962'], ['plate28', 0.5, 0.4, 1.5, 90, '#abb2b8'], ['brick24', 0.5, 0.8, 0.5, 0, '#515962'], ['slope22', 0.5, 0.4, -2.5, 0, '#515962'], ['canopy24', 0.5, 2, -1.5, 0, '#dba635'], ['plate22', 0.5, 0.4, 3.5, 0, '#515962'], ['plate26', 0.5, 0.8, 3.5, 90, '#abb2b8'], ['tile12', -3, 0.8, 1.5, 0, '#515962'], ['tile12', 4, 0.8, 1.5, 0, '#515962'], ['plate12', -1, 0.8, 1.5, 0, '#dba635'], ['plate12', 2, 0.8, 1.5, 0, '#dba635'], ['tile22', 0.5, 2, 1.5, 0, '#515962'], ['tile14', 0.5, 1.2, 3, 90, '#515962'],
  ];
  return validateDocument({ version: 1, name: '灰翼 · 自由改装', parts: definitions.map(([partId, x, y, z, rotation, color], i) => ({ id: `example-${i + 1}`, partId, x, y, z, rotation, color })) });
}

export const DOCUMENT_LIMITS = Object.freeze({ maxParts: MAX_PARTS, maxCoordinate: LIMIT, partTypes: PARTS.length });
