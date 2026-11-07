import bpy,json
print('BLENDER_INFO',json.dumps({'version':bpy.app.version_string,'engine':bpy.context.scene.render.engine},ensure_ascii=False),flush=True)
try:
    preferences=bpy.context.preferences.addons['cycles'].preferences
    preferences.get_devices()
    print('CYCLES_DEVICES',[(d.name,d.type) for d in preferences.devices],flush=True)
except Exception as error:print('CYCLES_DEVICES',str(error),flush=True)
