"""Build a real, editable LDraw parts library and a photographed catalogue.

Run with Blender's bundled Python, for example:
blender --background --factory-startup --python build_library.py
"""

from pathlib import Path
import argparse
import json
import math
import sys

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
from ldraw_import import import_part


# All entries must be manifest roots. The aliases stay recorded as published IDs.
CATEGORIES = [
    ("01", "基础砖", "BRICKS", ["3005", "3004", "3001"]),
    ("02", "薄板", "PLATES", ["3024", "3023", "3022", "3020", "3710", "3034", "3036"]),
    ("03", "光面与格栅", "TILES / GRILLES", ["3070b", "3069b", "2431", "2412b"]),
    ("04", "斜面与曲面", "SLOPES", ["3040b", "3039", "54200", "11477"]),
    ("05", "机械梁与孔砖", "TECHNIC BEAMS", ["3700", "3701", "32316", "32523", "32009"]),
    ("06", "轴与连接销", "AXLES / PINS", ["32062", "3705", "2780", "3673", "43093", "6558"]),
    ("07", "铰链", "HINGES", ["3937", "3938", "2429", "2430"]),
    ("08", "夹口与侧向连接", "CLIPS / BRACKETS", ["60470b", "60478", "11090", "4070", "99207", "44728"]),
    ("09", "球形关节", "BALL JOINTS", ["14417", "14418", "14704"]),
    ("10", "圆形件与座舱", "ROUND / CANOPY", ["98138", "3062b", "6141", "4740", "62360"]),
]

LABELS = {
    "3005": "1×1 砖", "3004": "1×2 砖", "3001": "2×4 砖 · 底面",
    "3024": "1×1 板", "3023": "1×2 板", "3022": "2×2 板", "3020": "2×4 板",
    "3710": "1×4 板", "3034": "2×8 板", "3036": "6×8 板",
    "3070b": "1×1 光面", "3069b": "1×2 光面", "2431": "1×4 光面", "2412b": "格栅板",
    "3040b": "1×2 斜砖", "3039": "2×2 斜砖", "54200": "小斜面", "11477": "曲面斜砖",
    "3700": "1×2 孔砖", "3701": "1×4 孔砖", "32316": "5 孔梁", "32523": "3 孔梁", "32009": "弯曲机械梁",
    "32062": "2L 轴", "3705": "4L 轴", "2780": "摩擦销", "3673": "连接销", "43093": "轴销", "6558": "长摩擦销",
    "3937": "铰链底座", "3938": "铰链上件", "2429": "铰链板底", "2430": "铰链板顶",
    "60470b": "双横夹板", "60478": "端部横杆板", "11090": "管夹", "4070": "侧凸点砖", "99207": "上翻支架", "44728": "下翻支架",
    "14417": "球头侧接板", "14418": "球窝侧接板", "14704": "中心球窝板",
    "98138": "圆光面", "3062b": "空心圆柱砖", "6141": "圆薄板", "4740": "反碟形件", "62360": "透明曲面座舱",
}


def linear_hex(value):
    values = [int(value.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values) + (1.0,)


def material(name, color, roughness=0.3, transmission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgba = linear_hex(color)
    mat.diffuse_color = rgba
    shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Metallic"].default_value = 0.0
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["IOR"].default_value = 1.47
    shader.inputs["Coat Weight"].default_value = 0.18 if not transmission else 0.35
    shader.inputs["Coat Roughness"].default_value = 0.25
    shader.inputs["Transmission Weight"].default_value = transmission
    mat["base_color_srgb"] = color
    mat["color_management"] = "sRGB hex decoded to scene-linear RGB"
    return mat


def collection(name, parent=None):
    result = bpy.data.collections.new(name)
    if parent is not None:
        parent.children.link(result)
    return result


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def cube(name, location, dimensions, mat, target, bevel=0.0):
    x, y, z = (d / 2 for d in dimensions)
    vertices = [(-x, -y, -z), (-x, -y, z), (-x, y, -z), (-x, y, z),
                (x, -y, -z), (x, -y, z), (x, y, -z), (x, y, z)]
    faces = [(0, 4, 6, 2), (1, 3, 7, 5), (0, 1, 5, 4), (2, 6, 7, 3), (0, 2, 3, 1), (4, 5, 7, 6)]
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = location
    if bevel:
        mod = obj.modifiers.new("Soft studio edge", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    return obj


def text(name, value, location, size, mat, target, font=None, align="LEFT"):
    data = bpy.data.curves.new(name + "_text", "FONT")
    data.body = value
    data.size = size
    data.align_x = align
    data.space_character = 1.06
    data.extrude = 0
    if font:
        data.font = font
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    target.objects.link(obj)
    obj.location = location
    return obj


def configure_render(scene, width, height, samples):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = 0.025
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 0.65
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.render.image_settings.color_depth = "8"
    scene["unit_contract"] = "1 Blender unit = 1 stud = 20 LDraw units"
    scene["render_notes"] = "Cycles; 64 final samples; OptiX RTX 3060 if available; denoised"
    preferences = bpy.context.preferences.addons["cycles"].preferences
    try:
        preferences.compute_device_type = "OPTIX"
        preferences.get_devices()
        optix = [device for device in preferences.devices if device.type == "OPTIX"]
        for device in preferences.devices:
            device.use = device.type == "OPTIX"
        scene.cycles.device = "GPU" if optix else "CPU"
        print("LIBRARY_RENDER_DEVICE", [(device.name, device.type, device.use) for device in preferences.devices], flush=True)
    except Exception as error:
        scene.cycles.device = "CPU"
        print("LIBRARY_RENDER_CPU_FALLBACK", str(error), flush=True)


def studio(scene, target, floor_mat, span=110.0):
    world = bpy.data.worlds.new(scene.name + "_World")
    world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == "BACKGROUND")
    background.inputs["Color"].default_value = linear_hex("#d4d2c7")
    background.inputs["Strength"].default_value = 0.22
    scene.world = world
    cube(scene.name + "_Ground", (0, 0, -0.19), (span, span, 0.3), floor_mat, target, 0.08)
    for name, location, energy, size, color in [
        ("Key softbox", (-28, -25, 62), 24000, 45, (1.0, 0.95, 0.88)),
        ("Fill softbox", (32, 5, 48), 6500, 38, (0.87, 0.92, 1.0)),
        ("Back softbox", (-5, 38, 58), 9000, 35, (1.0, 0.98, 0.93)),
    ]:
        data = bpy.data.lights.new(scene.name + "_" + name, "AREA")
        data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
        obj = bpy.data.objects.new(scene.name + "_" + name, data)
        target.objects.link(obj)
        obj.location = location
        point_at(obj, (0, 0, 0))


def finish_part(obj):
    mesh = obj.data
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if hasattr(mesh, "set_sharp_from_angle"):
        mesh.set_sharp_from_angle(angle=math.radians(35))
    bevel = obj.modifiers.new("Plastic edge radius · 0.012 stud", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(38)
    bevel.use_clamp_overlap = True
    bevel.harden_normals = True
    normals = obj.modifiers.new("Weighted planes and sharp boundaries", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    normals.weight = 35
    obj["finish"] = "0.012 stud bevel; 2 segments; 35 degree sharp edges; weighted normals"


def place_display(source, target, x, y, rz=0.0, upside_down=False):
    obj = source.copy()
    obj.data = source.data
    obj.asset_clear()
    if "asset_role" in obj:
        del obj["asset_role"]
    target.objects.link(obj)
    obj.name = "Display_" + source["partId"]
    obj.rotation_euler = (math.pi if upside_down else 0.0, 0.0, rz)
    # Layout transforms move the object, never its original mesh coordinates.
    obj.location = (0, 0, 0)
    matrix = obj.rotation_euler.to_matrix()
    corners = [matrix @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    maximum = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (minimum + maximum) / 2
    obj.location = (x - center.x, y - center.y, 0.165 - minimum.z)
    obj["catalog_layout_copy"] = True
    obj["canonical_asset"] = source.name
    obj["catalog_orientation"] = "Underside shown" if upside_down else "Natural orientation"
    return obj, maximum - minimum


def positions_for(index, part_ids):
    if index == 1:
        return {
            "3036": (-7.0, -0.4, 0), "3034": (4.2, 2.2, 0), "3020": (2.0, -0.8, 0),
            "3022": (7.5, -0.8, 0), "3710": (1.0, -3.4, 0), "3023": (6.0, -3.4, 0), "3024": (9.2, -3.4, 0),
        }
    if index == 4:
        return {"32009": (-6.0, -0.5, math.pi / 2), "32316": (3.4, 1.5, math.pi / 2),
                "32523": (9.0, 1.5, math.pi / 2), "3700": (2.0, -2.2, 0), "3701": (8.2, -2.2, 0)}
    if index == 9:
        return {"98138": (-9.0, 1.4, 0), "3062b": (-4.7, 1.4, 0), "6141": (-0.4, 1.4, 0),
                "4740": (3.9, 1.4, 0), "62360": (7.0, -2.2, 0)}
    count = len(part_ids)
    if count <= 4:
        pitch = 24 / count
        return {part_id: ((i - (count - 1) / 2) * pitch, -0.3, 0) for i, part_id in enumerate(part_ids)}
    return {part_id: (((i % 3) - 1) * 8.1, 1.5 if i < 3 else -2.2, 0) for i, part_id in enumerate(part_ids)}


def make_camera(scene, target, name, location, aim, ortho_scale):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    target.objects.link(obj)
    obj.location = location
    point_at(obj, aim)
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    data.lens = 60
    data.clip_end = 500
    scene.camera = obj
    return obj


def build(args):
    library_dir = PROJECT / "ldraw"
    manifest = json.loads((library_dir / "manifest.json").read_text(encoding="utf-8"))
    selected = [part for _, _, _, parts in CATEGORIES for part in parts]
    assert len(selected) == 47 and len(set(selected)) == 47
    assert set(selected) <= set(manifest["root_parts"]), "Catalogue contains unmanifested part IDs"
    output = PROJECT / "output"
    output.mkdir(parents=True, exist_ok=True)

    for scene in list(bpy.data.scenes):
        if len(bpy.data.scenes) == 1:
            scene.name = "PartsCatalog"
            catalog = scene
        else:
            bpy.data.scenes.remove(scene)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)

    catalog_stage = collection("Catalog studio", catalog.collection)
    catalog_parts = collection("Catalog display parts · 47", catalog.collection)
    labels = collection("Catalog labels", catalog.collection)
    assets = collection("PartsLibrary · LDraw · 47 assets")
    assets.use_fake_user = True
    assets["source"] = manifest["source"]
    assets["unit_contract"] = "Native LDraw origins; 1 stud = 1 Blender unit"
    sources = {}
    main_gray = material("Plastic · neutral mechanical grey", "#505659", 0.3)
    light_gray = material("Plastic · light grey", "#a9abad", 0.3)
    blue = material("Plastic · connector blue", "#1d579a", 0.28)
    amber = material("Plastic · amber transparent", "#d5a13a", 0.15, 0.85)
    gold = material("Plastic · warm ochre", "#bd9027", 0.3)
    panel_mat = material("Studio card · warm limestone", "#d0ccbf", 0.87)
    floor_mat = material("Studio ground · warm grey", "#b7b5a9", 0.91)
    ink = material("Labels · graphite", "#333935", 0.8)
    muted_ink = material("Labels · muted grey", "#666b62", 0.9)
    nodes, links = floor_mat.node_tree.nodes, floor_mat.node_tree.links
    geometry = nodes.new("ShaderNodeNewGeometry")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 55
    noise.inputs["Detail"].default_value = 2
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.065
    bump.inputs["Distance"].default_value = 0.018
    links.new(geometry.outputs["Position"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], next(node for node in nodes if node.type == "BSDF_PRINCIPLED").inputs["Normal"])

    font = None
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
    if font_path.is_file():
        try:
            font = bpy.data.fonts.load(str(font_path))
        except Exception as error:
            print("CATALOG_FONT_FALLBACK", str(error), flush=True)

    for index, (number, title_cn, title_en, part_ids) in enumerate(CATEGORIES):
        asset_group = collection(number + " · " + title_en, assets)
        bx = -14.1 if index % 2 == 0 else 14.1
        by = (2 - index // 2) * 12.8
        cube("Category panel " + number, (bx, by, 0.04), (26.8, 11.7, 0.2), panel_mat, catalog_stage, 0.11)
        text("Category " + number, number + "  " + (title_cn if font else title_en),
             (bx - 12.25, by + 4.35, 0.155), 0.82, ink, labels, font)
        text("Subtitle " + number, title_en + "  /  " + str(len(part_ids)) + " PARTS",
             (bx - 12.2, by + 3.78, 0.155), 0.25, muted_ink, labels)
        layout = positions_for(index, part_ids)
        for part_id in part_ids:
            mat = amber if part_id == "62360" else blue if part_id in {"43093", "6558"} else light_gray if part_id == "3673" else gold if part_id == "6141" else main_gray
            source = import_part(part_id, library_dir, collection=asset_group, material=mat,
                                 name="LDraw_" + part_id + " · " + LABELS[part_id].replace(" · 底面", ""))
            source["category"] = title_en
            source["asset_role"] = "Canonical reusable part with original LDraw mesh coordinates"
            source.use_fake_user = True
            finish_part(source)
            source.asset_mark()
            source.asset_data.description = source["description"] + " | " + source["source"] + " | 1 unit = 1 stud"
            source.asset_data.author = "LDraw contributors; attribution retained in object metadata"
            for tag in ("LDraw", title_en, "Mechanical brick", part_id):
                source.asset_data.tags.new(tag)
            sources[part_id] = source
            lx, ly, rz = layout[part_id]
            display, size = place_display(source, catalog_parts, bx + lx, by + ly, rz, part_id == "3001")
            label = part_id + "  " + LABELS[part_id] if font else part_id
            text("Part label " + part_id, label, (bx + lx, by + ly - size.y / 2 - 0.67, 0.16),
                 0.60, ink, labels, font, align="CENTER")

    text("Catalogue title", "积木零件库" if font else "MECHANICAL BRICK LIBRARY",
         (-26.5, 34.2, 0.02), 1.15, ink, labels, font)
    text("Catalogue note", "47 个真实零件  /  10 类  /  保留原始连接尺寸" if font else "47 REAL PARTS  /  10 FAMILIES  /  ORIGINAL LDRAW GEOMETRY",
         (-26.45, 32.9, 0.02), 0.43, muted_ink, labels, font)
    text("Catalogue attribution", "LDraw contributors · CC BY 4.0 / CC BY 2.0 where indicated · 1 unit = 1 stud",
         (-26.5, -33.7, 0.02), 0.28, muted_ink, labels)
    studio(catalog, catalog_stage, floor_mat, 150)
    camera = make_camera(catalog, catalog_stage, "Catalogue camera", (0, -59, 132), (0, 0.5, 0), 78)
    configure_render(catalog, args.width, args.height, args.samples)
    catalog.render.filepath = str(output / "parts_catalog.png")
    catalog["catalog_part_count"] = len(sources)
    catalog["catalog_categories"] = 10
    catalog["source_manifest"] = str(library_dir / "manifest.json")

    sandbox = bpy.data.scenes.new("Sandbox")
    build_here = collection("Build here · drag assets or append PartsLibrary", sandbox.collection)
    sandbox_stage = collection("Sandbox studio", sandbox.collection)
    studio(sandbox, sandbox_stage, floor_mat, 80)
    make_camera(sandbox, sandbox_stage, "Sandbox camera", (17, -22, 19), (0, 0, 0), 25)
    configure_render(sandbox, 1600, 1100, args.samples)
    sandbox["instructions"] = "Empty build area. Canonical object assets are in the Current File asset library. Shift+A or append/link PartsLibrary for reuse."
    sandbox["library_collection"] = assets.name
    sandbox["part_count"] = 0
    assert not list(build_here.objects), "Sandbox must start empty"

    credit = bpy.data.texts.new("LDRAW_LICENSE_AND_SOURCES.txt")
    credit.write("REAL LDRAW PARTS LIBRARY\n\nSource archive: " + manifest["source"] + "\nArchive SHA256: " + manifest["archive_sha256"] + "\n\n")
    credit.write("Each canonical object retains partId, description, source URL, authors, licenses and dependency filenames in ldraw_metadata.\n")
    credit.write("Original LDraw origin retained. Display copies are only translated/rotated, never rescaled.\nSelected IDs: " + ", ".join(selected) + "\n\n")
    for filename in ("CAreadme.txt", "Readme.txt"):
        path = library_dir / filename
        if path.is_file():
            credit.write("\n----- " + filename + " -----\n" + path.read_text(encoding="utf-8-sig", errors="replace") + "\n")
    instructions = bpy.data.texts.new("START_HERE.txt")
    instructions.write("积木零件库 / MECHANICAL BRICK LIBRARY\n\n")
    instructions.write("PartsCatalog: 47 independently editable, true-scale display parts, arranged in 10 families.\n")
    instructions.write("Sandbox: empty scene for free building. Marked canonical parts are available in the Current File asset library.\n")
    instructions.write("PartsLibrary: reusable collection; native LDraw origins and dimensions are preserved.\n")
    instructions.write("One Blender unit = one stud. Do not apply arbitrary scale when joining pieces.\n")
    instructions.write("Display geometry comes from the bundled LDraw files, not the previous 13-brick web example.\n")
    instructions.write("All source and license information is retained in LDRAW_LICENSE_AND_SOURCES.txt and each part's custom properties.\n")

    report = {"canonical_part_count": len(sources), "display_part_count": len(catalog_parts.objects),
              "category_count": len(CATEGORIES), "sandbox_build_part_count": len(build_here.objects),
              "part_ids": selected, "unit": "1 Blender unit = 1 stud", "font": font.filepath if font else "Builtin English",
              "render_engine": catalog.render.engine, "render_device": catalog.cycles.device,
              "resolution": [args.width, args.height], "samples": args.samples, "original_origins_preserved": True,
              "blend": str(output / "parts_library.blend"), "render": catalog.render.filepath}
    for obj in sources.values():
        assert obj.type == "MESH" and obj["partId"] in selected
        assert obj.location.length == 0 and all(abs(v - 1) < 1e-7 for v in obj.scale)
        assert all(math.isfinite(component) for vertex in obj.data.vertices for component in vertex.co)
        assert obj.get("source") and obj.get("license") and obj.asset_data
    assert report["display_part_count"] == 47
    assert sum(bool(obj.asset_data) for obj in bpy.data.objects) == 47
    assert sum(bool(obj.get("asset_role")) for obj in bpy.data.objects) == 47
    (output / "parts_library_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if bpy.context.window:
        bpy.context.window.scene = sandbox
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_location = (0, 0, 0)
                space.region_3d.view_distance = 22
                space.clip_end = 500
                space.overlay.grid_scale = 1
                space.shading.type = "MATERIAL"
                space.shading.use_scene_lights = True
                space.shading.use_scene_world = True
    # Embed the Chinese font so labels survive moving the .blend file.
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "parts_library.blend"))
    if not args.skip_render:
        print("CATALOG_RENDER_START", catalog.render.filepath, flush=True)
        bpy.ops.render.render(write_still=True, scene=catalog.name)
    print("PARTS_LIBRARY_COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--width", type=int, default=2400)
    cli.add_argument("--height", type=int, default=2100)
    cli.add_argument("--samples", type=int, default=64)
    cli.add_argument("--skip-render", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    build(cli.parse_args(argv))
