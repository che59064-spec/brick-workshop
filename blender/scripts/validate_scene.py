"""Run inside Blender against the saved study. Reports limits rather than hiding them."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'output/transformer_study.blend'))
scene=bpy.context.scene
parts=[o for o in scene.objects if 'part_instance_id' in o]
controller=bpy.data.objects['CTRL · Transformation']
ids=[o['part_instance_id'] for o in parts]
assert len(parts)==77 and len(set(ids))==77
assert all(o.type=='MESH' and o.data.polygons and o.get('source') and o.get('license') for o in parts)
samples=[];first={}
for frame in sorted(set(range(1,241,10))|{1,22,45,75,105,130,175,215,240}):
    scene.frame_set(frame);bpy.context.view_layer.update()
    assert len([o for o in scene.objects if 'part_instance_id' in o])==77
    corners=[o.matrix_world@Vector(c) for o in parts for c in o.bound_box]
    assert all(math.isfinite(v) for p in corners for v in p)
    assert all(all(abs(v-1)<1e-6 for v in o.scale) for o in parts)
    bounds=[[min(p[i] for p in corners),max(p[i] for p in corners)] for i in range(3)]
    assert bounds[2][0]>=-.13, f'Parts intersect studio ground at frame {frame}: {bounds[2][0]}'
    samples.append({'frame':frame,'transform':controller['transform'],'bounds':bounds})
    if frame==1:first={o.name:o.matrix_world.copy() for o in parts}
    if frame==240:
        drift=max(abs(o.matrix_world[r][c]-first[o.name][r][c]) for o in parts for r in range(4) for c in range(4))
        assert drift<1e-5
by_frame={s['frame']:s for s in samples}
assert abs(by_frame[1]['transform'])<1e-6 and abs(by_frame[105]['transform']-1)<1e-6
assert 0 < by_frame[45]['transform'] < 1 and 0 < by_frame[75]['transform'] < 1, 'Transformation must interpolate continuously'
report={'pass':True,'parts':len(parts),'frames_checked':len(samples),'return_pose_max_drift':drift,
 'samples':samples,'checks':['distinct stable part IDs','nonempty editable meshes','source/license metadata','finite transforms','no scale disappearance','round-trip return pose'],
 'not_validated':['exact reference reconstruction','connection mating and joint limits','swept self-collision','physical buildability']}
(ROOT/'output/validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SCENE_VALIDATION',json.dumps(report,ensure_ascii=False),flush=True)
