import { getPart } from './catalog.js';
import { getConnectionPoints } from './model.js';

const EPS=1e-5;
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);

function pickConnectorDisk({origin,direction,parts=[],meshHitDistance=null},type) {
  if(!vector(origin)||!vector(direction)||!Array.isArray(parts))return null;
  const length=Math.hypot(...direction);if(length<EPS)return null;
  const ray=direction.map(n=>n/length);
  const maxDistance=meshHitDistance===null?Infinity:meshHitDistance;
  if(typeof maxDistance!=='number'||Number.isNaN(maxDistance)||maxDistance<0)return null;
  let nearest=null;
  for(const part of parts){
    const definition=getPart(part.partId);
    if(part.visible===false||!definition||(type==='stud'&&definition.connectionStatus!=='audited-stud-layout'))continue;
    for(const connector of getConnectionPoints(part)){
      if(connector.type!==type)continue;
      const normalLength=Math.hypot(...connector.normal);
      if(normalLength<EPS||!Number.isFinite(normalLength))continue;
      const normal=connector.normal.map(n=>n/normalLength),facing=dot(ray,normal);
      if(facing>=-EPS)continue;
      const offset=type==='stud'?(definition.studHeight||.2):connector.length/2;
      const radius=type==='stud'?.3:(connector.mouthRadius??connector.radius);
      if(!Number.isFinite(offset)||!Number.isFinite(radius)||radius<=0)continue;
      const centre=connector.position.map((n,i)=>n+normal[i]*offset);
      const distance=dot(centre.map((n,i)=>n-origin[i]),normal)/facing;
      if(distance<0||distance>maxDistance+EPS||distance>=(nearest?.distance??Infinity))continue;
      const point=origin.map((n,i)=>n+ray[i]*distance),delta=point.map((n,i)=>n-centre[i]);
      const radialSquared=dot(delta,delta)-dot(delta,normal)**2;
      if(radialSquared>radius**2+EPS**2)continue;
      nearest={part,point,normal,distance,connector};
    }
  }
  return nearest;
}

/** Fill audited hollow stud caps for picking only; physical meshes and collision stay unchanged. */
export const pickStudConnector=options=>pickConnectorDisk(options,'stud');

/** Pin-hole metadata locates its actual entry plane from the audited engagement centre. */
export const pickMechanicalConnector=options=>pickConnectorDisk(options,'pin-hole');
