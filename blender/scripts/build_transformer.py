"""Build an editable, LDraw-part-based Blender transformation study.

The mechanism is an original pose study inferred from video views, not a verified
reconstruction of hidden connections. Every physical part remains a mesh object.
"""
import sys, math, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector, Matrix
from ldraw_import import import_part

OUT=ROOT/'output';OUT.mkdir(parents=True,exist_ok=True)
LIB=ROOT/'ldraw'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
model=bpy.data.collections.new('01 · Mechanical transformer | 独立积木')
scene.collection.children.link(model)
studio=bpy.data.collections.new('02 · Studio | 摄影棚')
scene.collection.children.link(studio)

def linear(v):return v/12.92 if v<=0.04045 else ((v+.055)/1.055)**2.4
def material(name,hexcolor,roughness=.29,transmission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    shader=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    rgb=tuple(linear(int(hexcolor[i:i+2],16)/255) for i in (1,3,5))
    shader.inputs['Base Color'].default_value=(*rgb,1)
    shader.inputs['Roughness'].default_value=roughness
    if shader.inputs.get('Coat Weight'):shader.inputs['Coat Weight'].default_value=.22
    if shader.inputs.get('Coat Roughness'):shader.inputs['Coat Roughness'].default_value=.25
    if shader.inputs.get('Transmission Weight'):shader.inputs['Transmission Weight'].default_value=transmission
    shader.inputs['IOR'].default_value=1.46
    m.diffuse_color=(*rgb,1)
    return m
DARK=material('ABS · Dark mechanical grey','#4b4e4c')
LIGHT=material('ABS · Light stone grey','#a4a6a0')
GOLD=material('ABS · Warm gold','#b98824',.3)
BLUE=material('ABS · Connector blue','#2466b8')
BLACK=material('ABS · Inner charcoal','#2c302e')
GLASS=material('PC · Transparent amber','#d4a32e',.13,.7)

def joint(name,parent,location,description=''):
    o=bpy.data.objects.new(name,None);model.objects.link(o)
    o.empty_display_type='PLAIN_AXES';o.empty_display_size=.32
    o.parent=parent;o.location=location;o['purpose']=description
    return o

controller=joint('CTRL · Transformation',None,(0,0,0),'0 aircraft / 1 humanoid; editable pose study')
controller['transform']=0.0
controller.id_properties_ui('transform').update(min=0,max=1,description='0 飞机 / 1 人形；可拖动或播放时间轴')
body=joint('M40 · Chest and waist',controller,(0,0,8.7))

def drive(obj,path,index,plane,robot,start=0,end=1):
    f=obj.driver_add(path,index)
    d=f.driver;d.type='SCRIPTED'
    v=d.variables.new();v.name='t';v.type='SINGLE_PROP';v.targets[0].id=controller;v.targets[0].data_path='["transform"]'
    s=f'min(max((t-{start})/{end-start},0),1)'
    d.expression=f'{plane}+({robot-plane})*({s})'
    return f

drive(body,'rotation_euler',0,math.pi/2,0,.1,.8)
lift=drive(body,'location',2,2.8,8.7,.1,.8)
lift.driver.expression+='+2.0*sin(3.141592653589793*t)'

parts=[]
def piece(pid,name,parent,center,rotation=(0,0,0),mat=DARK):
    obj=import_part(str(pid),LIB,collection=model,material=mat,name=f'{name} | {pid}')
    obj.rotation_mode='XYZ'
    if isinstance(rotation,Matrix):obj.rotation_euler=rotation.to_euler()
    else:obj.rotation_euler=rotation
    rot=obj.rotation_euler.to_matrix()
    corners=[rot@Vector(c) for c in obj.bound_box]
    middle=Vector(tuple((min(c[i] for c in corners)+max(c[i] for c in corners))/2 for i in range(3)))
    obj.parent=parent;obj.location=Vector(center)-middle
    obj['module']=parent.name;obj['reference_status']='candidate / inferred assembly'
    obj['part_instance_id']=f'BW-{len(parts)+1:03d}'
    for polygon in obj.data.polygons:polygon.use_smooth=True
    if hasattr(obj.data,'set_sharp_from_angle'):obj.data.set_sharp_from_angle(angle=math.radians(35))
    bevel=obj.modifiers.new('Small moulded edge highlights','BEVEL');bevel.width=.012;bevel.segments=2
    bevel.limit_method='ANGLE';bevel.angle_limit=math.radians(35)
    try:
        normal=obj.modifiers.new('Weighted plastic surface normals','WEIGHTED_NORMAL');normal.keep_sharp=True
    except Exception:pass
    parts.append(obj);return obj

# Matrix columns: plate's long X axis becomes upright Z; its studs face into body.
reverse_long=Matrix(((0,-1,0),(0,0,-1),(1,0,0)))
front=(math.pi/2,0,0)
long_upright=(0,math.pi/2,0)
for z in [-1.1,.1,1.3]:piece('3004','Torso core',body,(0,0,z),mat=BLACK)
for x in [-1,0,1]:piece('3710','M00 reversed channel plate',body,(x,.79,.25),reverse_long)
for sign in [-1,1]:
    piece('54200','Angular chest armour',body,(sign*.55,-.78,.95),front)
    piece('3070b','Gold chest inset',body,(sign*1.0,-.88,-.1),front,GOLD)
    piece('4070','SNOT structural mount',body,(sign*.95,0,-1.1),mat=DARK)
    piece('3062b','Hip transverse cylinder',body,(sign*.9,0,-2.0),(0,math.pi/2,0),DARK)
    piece('43093','Visible blue axle-pin',body,(sign*.7,0,-2.0),(0,0,math.pi/2),BLUE)
for z in [-.55,-1.2]:piece('6141','Abdomen round stud',body,(0,-.82,z),front,DARK)
piece('2412b','Central mechanical grille',body,(0,.99,-1.1),front,DARK)

head=joint('M50 · Small wedge head',body,(0,0,2.12))
piece('3062b','Short neck',head,(0,0,.15),mat=BLACK)
piece('54200','Small sloped head',head,(0,-.06,.56),(0,0,math.pi),DARK)

nose=joint('J10 · Nose and canopy fold',body,(0,.7,1.8),'Backpack fold is inferred; hidden axis unverified')
drive(nose,'rotation_euler',0,0,math.radians(170),.65,1)
drive(nose,'location',1,.7,1.7,.55,1)
piece('3710','Nose backbone',nose,(0,0,1.65),reverse_long,DARK)
piece('11477','Small transparent canopy',nose,(0,.45,2.2),(-math.pi/2,0,0),GLASS)
piece('3040b','Pointed nose',nose,(0,.12,3.45),(-math.pi/2,0,0),DARK)
for sign in [-1,1]:
    piece('3062b','Nose round housing',nose,(sign*.62,.1,.85),mat=DARK)
    piece('3062b','Nose round housing upper',nose,(sign*.62,.1,1.65),mat=DARK)
    piece('6141','Nose gold end ring',nose,(sign*.62,.1,2.15),mat=GOLD)
piece('60478','Nose folding handle',nose,(0,.12,-.2),front,DARK)

for sign,label in [(-1,'L'),(1,'R')]:
    shoulder=joint(f'J30-{label} · Shoulder',body,(sign*1.75,.08,1.45),'Independent shoulder rotation')
    drive(shoulder,'rotation_euler',1,sign*math.pi,sign*math.radians(-8),.35,.9)
    piece('3937',f'{label} shoulder hinge base',body,(sign*1.5,.05,1.6),front,DARK)
    piece('3938',f'{label} shoulder hinge cap',shoulder,(0,0,-.1),front,DARK)
    piece('3062b',f'{label} shoulder round cap',shoulder,(sign*.35,0,-.15),(0,math.pi/2,0),DARK)
    piece('3004',f'{label} upper arm core',shoulder,(0,0,-.82),long_upright,DARK)
    elbow=joint(f'J31-{label} · Elbow',shoulder,(0,0,-1.55))
    drive(elbow,'rotation_euler',1,sign*math.pi,sign*math.radians(-4),.4,.95)
    piece('3710',f'{label} forearm channel',elbow,(0,.2,-1.55),reverse_long,DARK)
    piece('2431',f'{label} forearm outer tile',elbow,(0,-.19,-1.55),reverse_long,DARK)
    piece('11090',f'{label} wrist clip',elbow,(0,0,-3.55),mat=DARK)
    piece('2412b',f'{label} arm end grille',elbow,(0,-.3,-2.7),front,DARK)

    hip=joint(f'J20-{label} · Hip wing swivel',body,(sign*1.05,0,-2.2),'Leg module becomes broad side assembly')
    drive(hip,'rotation_euler',1,-sign*math.pi/2,0,0,.65)
    piece('14417',f'{label} hip ball',hip,(0,0,-.05),mat=DARK)
    piece('14418',f'{label} hip socket',hip,(0,0,-.45),mat=LIGHT)
    piece('3004',f'{label} thigh structure',hip,(0,0,-1.1),long_upright,LIGHT)
    piece('3069b',f'{label} thigh armour',hip,(0,-.62,-1.0),reverse_long,DARK)
    knee=joint(f'J21-{label} · Knee',hip,(0,0,-2.1),'Fold clearance requires physical review')
    drive(knee,'rotation_euler',1,sign*math.pi/2,0,.1,.72)
    piece('3937',f'{label} knee hinge',knee,(0,0,-.05),front,DARK)
    piece('3062b',f'{label} knee circular cover',knee,(sign*.4,0,-.1),(0,math.pi/2,0),LIGHT)
    piece('3710',f'{label} shin long structural plate',knee,(0,0,-1.65),reverse_long,LIGHT)
    for dx in [-.29,.29]:piece('2431',f'{label} paired light shin rail',knee,(dx,-.22,-1.65),reverse_long,LIGHT)
    piece('3069b',f'{label} shin dark armour',knee,(0,-.5,-1.05),reverse_long,DARK)
    piece('2412b',f'{label} shin grille',knee,(0,-.46,-2.5),front,DARK)
    piece('43723' if sign<0 else '43722',f'{label} outer tapered wing',knee,(sign*.8,.28,-2.7),(-math.pi/2,0,0),DARK)
    foot=joint(f'J22-{label} · Foot and wing tip',knee,(0,0,-3.45))
    drive(foot,'rotation_euler',0,-math.pi/2,0,.15,.8)
    piece('3040b',f'{label} wedge foot',foot,(0,-.55,-.28),(0,0,0),DARK)
    piece('3022',f'{label} foot sole',foot,(0,-.15,-.72),mat=DARK)
    piece('3062b',f'{label} hollow wing nozzle',foot,(0,.35,.06),front,LIGHT)

for frame,value in [(1,0),(22,0),(105,1),(130,1),(215,0),(240,0)]:
    controller['transform']=float(value);controller.keyframe_insert(data_path='["transform"]',frame=frame)
scene.frame_start=1;scene.frame_end=240;scene.render.fps=30
for name,frame in [('AIRCRAFT · 飞机',1),('Unfold · 展开',45),('HUMANOID · 人形',105),('Return · 返回',155)]:scene.timeline_markers.new(name,frame=frame)

def aim(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
world=bpy.data.worlds.new('Warm studio world');world.use_nodes=True
next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs['Color'].default_value=(.62,.62,.56,1)
next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs['Strength'].default_value=.3
scene.world=world
floor_mat=material('Warm grey lightly textured ground','#dddccb',.88)
nodes=floor_mat.node_tree.nodes;links=floor_mat.node_tree.links
shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=150
noise.inputs['Detail'].default_value=2
bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.14;bump.inputs['Distance'].default_value=.018
links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],shader.inputs['Normal'])
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.1));ground=bpy.context.object;ground.name='Studio warm-grey floor';ground.data.materials.append(floor_mat)
for c in list(ground.users_collection):c.objects.unlink(ground)
studio.objects.link(ground)
def area(name,loc,power,size,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);studio.objects.link(o);o.location=loc;aim(o,target)
area('Large soft key',(-7,-10,17),1450,8,(0,0,4))
area('Subtle side fill',(10,-2,9),350,7,(0,0,5))
area('Soft rear edge',(-3,8,14),650,6,(0,0,5))
data=bpy.data.cameras.new('Reference study camera');camera=bpy.data.objects.new('Reference study camera',data);studio.objects.link(camera);scene.camera=camera
data.type='ORTHO';data.lens=52;data.clip_end=300

try:scene.render.engine='CYCLES'
except TypeError:pass
if hasattr(scene,'cycles'):
    scene.cycles.samples=48;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
        for d in prefs.devices:d.use=d.type=='OPTIX'
        scene.cycles.device='GPU'
    except Exception:scene.cycles.device='CPU'
scene.render.resolution_x=900;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene['project_status']='REFERENCE-BASED STUDY; hidden mechanism inferred, collision/manufacturing not validated'
scene['source_video']='https://www.douyin.com/video/7691906855547607370'
scene['parts_count']=len(parts)
scene['instructions']='Select CTRL · Transformation > Custom Properties > transform. 0 aircraft / 1 humanoid. Timeline 1–240. Each physical part is independent. Reference reconstruction is approximate.'
readme=bpy.data.texts.new('READ ME · 使用说明')
readme.write('积木变形研究场景\n\n每个积木是独立、可编辑的 LDraw 网格；名称与自定义属性保留件号/来源/许可。\n选择 CTRL · Transformation，在物体自定义属性拖动 transform：0 飞机、1 人形；或播放时间轴。\n注意：这是依据多个视频截帧制作的候选机构与外形研究。隐藏连接和扫掠干涉未完成实物级验证，不等于原作品的精确复刻。\n可用另一个 parts_library.blend 的 Sandbox 场景继续自由搭建。\n')
report={'parts_count':len(parts),'part_types':sorted({o['partId'] for o in parts}),'joints':[o.name for o in model.objects if o.type=='EMPTY'],
        'source_video':scene['source_video'],'mechanism_status':'inferred pose study, not collision-validated','blender':bpy.app.version_string}
(OUT/'transformer_manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

def view_contract(frame,offset):
    scene.frame_set(frame);bpy.context.view_layer.update()
    points=[obj.matrix_world@Vector(c) for obj in parts for c in obj.bound_box]
    center=Vector(tuple((min(p[i] for p in points)+max(p[i] for p in points))/2 for i in range(3)))
    rotation=(-Vector(offset)).to_track_quat('-Z','Y').to_matrix()
    projected=[rotation.transposed()@(p-center) for p in points]
    width=max(p.x for p in projected)-min(p.x for p in projected)
    height=max(p.y for p in projected)-min(p.y for p in projected)
    scale=max(height,width/scene.render.resolution_x*scene.render.resolution_y)*1.4
    return center,center+Vector(offset),scale

plane_view=view_contract(1,(14,-20,17))
robot_view=view_contract(105,(15,-26,10))
target=bpy.data.objects.new('Studio framing target',None);studio.objects.link(target)
target.empty_display_size=.1
for i in range(3):
    target_curve=drive(target,'location',i,plane_view[0][i],robot_view[0][i])
    camera_curve=drive(camera,'location',i,plane_view[1][i],robot_view[1][i])
    if i==2:
        target_curve.driver.expression+='+2.0*sin(3.141592653589793*t)'
        camera_curve.driver.expression+='+2.0*sin(3.141592653589793*t)'
drive(data,'ortho_scale',-1,plane_view[2],robot_view[2])
track=camera.constraints.new('TRACK_TO');track.target=target;track.track_axis='TRACK_NEGATIVE_Z';track.up_axis='UP_Y'
def set_view(frame):
    scene.frame_set(frame);bpy.context.view_layer.update()

set_view(1)
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type=='VIEW_3D':
            area_ui.spaces.active.region_3d.view_perspective='CAMERA'
            area_ui.spaces.active.shading.type='MATERIAL'
bpy.context.view_layer.objects.active=controller;controller.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'transformer_study.blend'))
for frame,name in [(1,'aircraft'),(105,'humanoid')]:
    set_view(frame);scene.render.filepath=str(OUT/f'{name}.png')
    bpy.ops.render.render(write_still=True)
set_view(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'transformer_study.blend'))
print('BUILT_TRANSFORMER',json.dumps(report),flush=True)
