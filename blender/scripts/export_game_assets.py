"""Export real LDraw parts and the Blender pose study for the browser game.

Normal Python --metadata-only writes the catalogue immediately. Full export runs
inside Blender, without loading or modifying the user's live scene.
"""
from pathlib import Path
import argparse
import ast
import json
import math
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT.parent / "brick-workshop" / "public" / "assets"
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

CATEGORY_IDS = {
    "BRICKS": "bricks", "PLATES": "plates", "TILES / GRILLES": "tiles", "SLOPES": "slopes",
    "TECHNIC BEAMS": "technic", "AXLES / PINS": "pins", "HINGES": "hinges",
    "CLIPS / BRACKETS": "clips", "BALL JOINTS": "joints", "ROUND / CANOPY": "rounds",
}
STACKING_PARTS = {
    "3001", "3004", "3005", "3024", "3023", "3022", "3020", "3710", "3034", "3036",
    "3070b", "3069b", "2431", "2412b", "3040b", "3039", "54200", "11477",
    "98138", "3062b", "6141", "4740", "4070", "3700", "3701", "43722", "43723",
}


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def catalogue_definitions():
    tree = ast.parse((SCRIPTS / "build_library.py").read_text(encoding="utf-8"))
    values = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            for target in statement.targets:
                if isinstance(target, ast.Name) and target.id in {"CATEGORIES", "LABELS"}:
                    values[target.id] = ast.literal_eval(statement.value)
    return values["CATEGORIES"], values["LABELS"]


def bounds_metadata(part_id, raw_bounds, name, category, metadata, triangles=None):
    low, high = raw_bounds
    center = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]]
    width, depth, full_height = [high[i] - low[i] for i in range(3)]
    height = -low[2] if part_id in STACKING_PARTS and low[2] < -1e-6 else full_height
    bbox = [[-width / 2, 0.0, -depth / 2], [width / 2, full_height, depth / 2]]
    body_bounds = [bbox[0].copy(), [width / 2, height, depth / 2]]
    shape = {"bricks": "brick", "plates": "plate", "tiles": "tile", "slopes": "slope",
             "technic": "technic", "pins": "pin", "hinges": "hinge", "clips": "bracket",
             "joints": "balljoint", "rounds": "round"}.get(category, "ldraw")
    if part_id == "62360":
        shape = "canopy"
    return {
        "id": part_id, "ldrawId": part_id, "templateId": "ld_" + part_id,
        "name": name.replace(" · 底面", ""), "category": category,
        "description": metadata.get("description", name),
        "width": round(width, 8), "depth": round(depth, 8), "height": round(height, 8),
        "meshHeight": round(full_height, 8), "bbox": bbox,
        "bounds": {"min": bbox[0], "max": bbox[1]}, "bodyBounds": body_bounds,
        "sourceBoundsBlender": [list(low), list(high)], "sourceCenterBlender": center,
        "sourceOriginInGame": [-center[0], -center[2], center[1]],
        "dimensionsSource": "Real LDraw surface bounds; known stacking pieces use original top datum Z=0 for height, excluding studs",
        "coordinateSystem": "Three.js Y-up; X/Z bounding-box centre; bottom Y=0; 1 unit=1 stud",
        "nodeName": "part_" + part_id, "glb": "/assets/parts.glb", "shape": shape,
        "connections": {"status": "unverified", "points": [], "note": "No automatic studs inferred from bounding boxes; use an audited connector table"},
        "triangles": triangles, "source": metadata.get("source_url", ""),
        "sourceFiles": metadata.get("source_files", []), "authors": metadata.get("authors", []),
        "license": metadata.get("license", ""), "licenses": metadata.get("licenses", []),
    }


def bootstrap_metadata():
    from ldraw_import import LDrawParser
    categories, labels = catalogue_definitions()
    parser = LDrawParser(ROOT / "ldraw")
    parts = []
    for _, _, title_en, ids in categories:
        for part_id in ids:
            data = parser.parse(part_id)
            parts.append(bounds_metadata(part_id, data.bbox, labels[part_id], CATEGORY_IDS[title_en], data.metadata))
    result = {"schemaVersion": 1, "glb": "/assets/parts.glb", "unit": "1 stud", "axis": "Y-up",
              "preliminary": True, "parts": parts,
              "categories": [{"id": CATEGORY_IDS[en], "name": cn} for _, cn, en, _ in categories]}
    PUBLIC.mkdir(parents=True, exist_ok=True)
    atomic_json(PUBLIC / "catalog-data.json", result)
    supplement = []
    for part_id in ("43722", "43723"):
        data = parser.parse(part_id)
        entry = bounds_metadata(part_id, data.bbox, data.metadata["description"], "wings", data.metadata)
        entry["shape"] = "wing"
        entry["glb"] = "/assets/demo-parts.glb"
        supplement.append(entry)
    atomic_json(PUBLIC / "demo-catalog-data.json", {"schemaVersion": 1, "glb": "/assets/demo-parts.glb", "unit": "1 stud", "axis": "Y-up", "preliminary": True, "parts": supplement})
    return result


def append_collection(path, prefix):
    import bpy
    with bpy.data.libraries.load(str(path), link=False) as (available, requested):
        names = [name for name in available.collections if name.startswith(prefix)]
        if len(names) != 1:
            raise RuntimeError("Expected one source collection " + prefix + ": " + repr(names))
        requested.collections = names
    return requested.collections[0]


def clean_number(value):
    value = float(value)
    return 0.0 if abs(value) < 1e-9 else round(value, 8)


def game_matrix(matrix):
    from mathutils import Matrix
    basis = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    return basis @ matrix @ basis.inverted()


def matrix_values(matrix):
    return [clean_number(matrix[row][column]) for column in range(4) for row in range(4)]


def transform_values(matrix):
    position, quaternion, scale = matrix.decompose()
    quaternion.normalize()
    assert all(abs(value - 1) < 1e-5 for value in scale), "Unexpected part scale"
    return {"position": [clean_number(v) for v in position],
            "quaternion": [clean_number(quaternion.x), clean_number(quaternion.y), clean_number(quaternion.z), clean_number(quaternion.w)],
            "scale": [1, 1, 1], "localMatrix": matrix_values(matrix)}


def node_material(obj):
    mat = next((mat for mat in obj.data.materials if mat and mat.use_nodes), None)
    if not mat:
        return {"color": "#505659", "roughness": 0.3, "metalness": 0.0, "transmission": 0.0}
    shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    rgba = shader.inputs["Base Color"].default_value
    def srgb(value):
        return 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
    color = "#" + "".join("%02x" % round(min(1, max(0, srgb(value))) * 255) for value in rgba[:3])
    transmission = shader.inputs.get("Transmission Weight")
    return {"color": color, "roughness": clean_number(shader.inputs["Roughness"].default_value),
            "metalness": clean_number(shader.inputs["Metallic"].default_value),
            "transmission": clean_number(transmission.default_value) if transmission else 0.0,
            "ior": clean_number(shader.inputs["IOR"].default_value), "name": mat.name}


def create_export_mesh(source, entry, target, bevel_segments=1):
    import bpy
    from mathutils import Matrix, Vector
    obj = source.copy()
    raw_mesh = source.data.copy()
    obj.data = raw_mesh
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    target.objects.link(obj)
    for mod in list(obj.modifiers):
        if mod.type == "BEVEL":
            if bevel_segments:
                mod.segments = bevel_segments
                mod.width = min(mod.width, 0.01)
            else:
                obj.modifiers.remove(mod)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
    bpy.data.objects.remove(obj, do_unlink=True)
    if raw_mesh.users == 0:
        bpy.data.meshes.remove(raw_mesh)
    offset = Vector(entry["sourceCenterBlender"])
    mesh.transform(Matrix.Translation(-offset))
    mesh.update()
    mesh.calc_loop_triangles()
    output = bpy.data.objects.new(entry["nodeName"], mesh)
    target.objects.link(output)
    output["partId"] = entry["id"]
    output["unit"] = "1 stud"
    output["origin"] = "XZ centred; bottom Y=0 after glTF Y-up conversion"
    assert output.scale[:] == (1.0, 1.0, 1.0)
    assert all(math.isfinite(value) for vertex in mesh.vertices for value in vertex.co)
    assert all(polygon.normal.length > 1e-6 for polygon in mesh.polygons)
    entry["triangles"] = len(mesh.loop_triangles)
    entry["verticesBeforeGltfSplit"] = len(mesh.vertices)
    entry["defaultMaterial"] = node_material(output)
    return output


def decode_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data)
    assert magic == b"glTF" and version == 2 and length == len(data)
    cursor, document, binary = 12, None, None
    while cursor < len(data):
        chunk_size, chunk_type = struct.unpack_from("<II", data, cursor)
        cursor += 8
        chunk = data[cursor:cursor + chunk_size]
        if chunk_type == 0x4E4F534A:
            document = json.loads(chunk)
        elif chunk_type == 0x004E4942:
            binary = chunk
        cursor += chunk_size
    assert document is not None and binary is not None
    return document, binary


def accessor_vectors(document, binary, index, dimensions):
    accessor = document["accessors"][index]
    assert accessor["componentType"] == 5126
    view = document["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", dimensions * 4)
    for i in range(accessor["count"]):
        yield struct.unpack_from("<" + "f" * dimensions, binary, start + stride * i)


def validate_glb(path, entries):
    document, binary = decode_glb(path)
    roots = document["scenes"][document.get("scene", 0)]["nodes"]
    nodes = [document["nodes"][index] for index in roots]
    expected = {entry["nodeName"] for entry in entries}
    assert len(nodes) == len(expected) and {node["name"] for node in nodes} == expected
    assert not document.get("cameras")
    total_triangles, node_stats = 0, {}
    for node in nodes:
        assert "mesh" in node and not node.get("children"), "Part root must be one independent mesh"
        assert all(abs(value - 1) < 1e-6 for value in node.get("scale", (1, 1, 1)))
        assert all(abs(value) < 1e-6 for value in node.get("translation", (0, 0, 0)))
        rotation = node.get("rotation", (0, 0, 0, 1))
        assert all(abs(rotation[i]) < 1e-6 for i in range(3)) and abs(abs(rotation[3]) - 1) < 1e-6
        triangles, vertices = 0, 0
        mesh = document["meshes"][node["mesh"]]
        point_min = [math.inf] * 3
        point_max = [-math.inf] * 3
        for primitive in mesh["primitives"]:
            assert primitive.get("mode", 4) == 4 and "NORMAL" in primitive["attributes"]
            pos_accessor = primitive["attributes"]["POSITION"]
            vertices += document["accessors"][pos_accessor]["count"]
            for vector in accessor_vectors(document, binary, pos_accessor, 3):
                assert all(math.isfinite(value) for value in vector)
                point_min = [min(a, b) for a, b in zip(point_min, vector)]
                point_max = [max(a, b) for a, b in zip(point_max, vector)]
            for normal in accessor_vectors(document, binary, primitive["attributes"]["NORMAL"], 3):
                assert all(math.isfinite(value) for value in normal)
                assert abs(sum(value * value for value in normal) - 1) < 0.01, "Invalid exported normal"
            triangles += document["accessors"][primitive["indices"]]["count"] // 3
        # A baked edge bevel can remove an extremal vertex; keep the raw mating datum.
        assert abs(point_min[1]) < 0.025, (node["name"], "bottom", point_min)
        assert abs(point_max[0] + point_min[0]) < 0.025, (node["name"], "X centre")
        assert abs(point_max[2] + point_min[2]) < 0.025, (node["name"], "Z centre")
        node_stats[node["name"]] = {"triangles": triangles, "vertices": vertices, "bbox": [point_min, point_max]}
        total_triangles += triangles
    return {"bytes": path.stat().st_size, "rootNodes": len(nodes), "triangles": total_triangles,
            "nodes": node_stats, "normalsValidated": True, "unitScaleValidated": True, "originValidated": True, "originToleranceStud":0.025}


def export_glb(scene, objects, entries, filename):
    import bpy
    bpy.context.window.scene = scene
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    temporary = PUBLIC / (filename.removesuffix(".glb") + ".tmp.glb")
    options = {
        "filepath": str(temporary), "export_format": "GLB", "use_selection": True,
        "export_yup": True, "export_apply": False, "export_texcoords": False,
        "export_normals": True, "export_tangents": False, "export_materials": "EXPORT",
        "export_animations": False, "export_extras": True, "export_lights": False,
        "export_cameras": False, "export_unused_images": False,
    }
    supported = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(**{key: value for key, value in options.items() if key in supported})
    report = validate_glb(temporary, entries)
    temporary.replace(PUBLIC / filename)
    return report


def export_demo(source_collection, export_scene, export_collection, catalog, bevel_segments):
    import bpy
    from mathutils import Matrix, Vector
    demo_collection = append_collection(ROOT / "output" / "transformer_study.blend", "01 · Mechanical transformer")
    demo_scene = bpy.data.scenes.new("GamePoseEvaluation")
    demo_scene.collection.children.link(demo_collection)
    parts = [obj for obj in demo_collection.all_objects if obj.type == "MESH" and obj.get("part_instance_id")]
    assert len(parts) == 77
    supplement = json.loads((PUBLIC / "demo-catalog-data.json").read_text(encoding="utf-8"))
    extra_objects = []
    bpy.context.window.scene = export_scene
    for entry in supplement["parts"]:
        source = next(obj for obj in parts if obj["partId"] == entry["id"])
        extra_objects.append(create_export_mesh(source, entry, export_collection, bevel_segments))
    supplement["preliminary"] = False
    supplement["statistics"] = export_glb(export_scene, extra_objects, supplement["parts"], "demo-parts.glb")
    atomic_json(PUBLIC / "demo-catalog-data.json", supplement)
    templates = {entry["id"]: entry for entry in catalog["parts"] + supplement["parts"]}
    bpy.context.window.scene = demo_scene
    graph_objects = [obj for obj in demo_collection.all_objects if obj.type == "EMPTY" or obj.get("part_instance_id")]
    ordered = []
    def visit(obj):
        if obj in ordered:
            return
        if obj.parent in graph_objects:
            visit(obj.parent)
        ordered.append(obj)
    for obj in sorted(graph_objects, key=lambda obj: obj.name):
        visit(obj)
    ids = {obj: obj["part_instance_id"] if obj.get("part_instance_id") else "joint_%02d" % index
           for index, obj in enumerate(ordered)}
    nodes = []
    for obj in ordered:
        info = {"id": ids[obj], "parentId": ids.get(obj.parent), "name": obj.name,
                "type": "part" if obj.get("part_instance_id") else "joint"}
        if info["type"] == "part":
            entry = templates[obj["partId"]]
            info.update({"ldrawId": entry["id"], "templateId": entry["templateId"],
                         "nodeName": entry["nodeName"], "glb": entry["glb"], "material": node_material(obj)})
        nodes.append(info)
    controller = next(obj for obj in ordered if obj.type == "EMPTY" and "transform" in obj)
    controller.animation_data_clear()
    poses = []
    for step in range(11):
        t = step / 10
        controller["transform"] = t
        controller.update_tag()
        demo_scene.frame_set(1)
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        graph.update()
        transforms = []
        world_by_object = {obj: obj.evaluated_get(graph).matrix_world.copy() for obj in ordered}
        for obj in ordered:
            world = world_by_object[obj]
            local = world_by_object[obj.parent].inverted_safe() @ world if obj.parent in world_by_object else world.copy()
            if obj.get("part_instance_id"):
                offset = Matrix.Translation(Vector(templates[obj["partId"]]["sourceCenterBlender"]))
                world = world @ offset
                local = local @ offset
            local_game, world_game = game_matrix(local), game_matrix(world)
            transform = {"id": ids[obj], **transform_values(local_game), "worldMatrix": matrix_values(world_game)}
            transforms.append(transform)
        poses.append({"t": t, "nodes": transforms})
    rest = []
    by_id = {node["id"]: node for node in nodes}
    for transform in poses[0]["nodes"]:
        info = by_id[transform["id"]]
        if info["type"] != "part":
            continue
        values = transform["worldMatrix"]
        matrix = Matrix(tuple(tuple(values[column * 4 + row] for column in range(4)) for row in range(4)))
        position, quaternion, scale = matrix.decompose()
        rest.append({"id": info["id"], "templateId": info["templateId"], "ldrawId": info["ldrawId"],
                     "position": [clean_number(value) for value in position],
                     "rotation": [clean_number(value) for value in quaternion.to_euler("XYZ")],
                     "quaternion": [clean_number(quaternion.x), clean_number(quaternion.y), clean_number(quaternion.z), clean_number(quaternion.w)],
                     "color": info["material"]["color"], "material": info["material"]})
    result = {"schemaVersion": 1, "name": "Mechanical transformer pose study", "unit": "1 stud", "axis": "Y-up",
              "glb": "/assets/parts.glb", "supplementGlb": "/assets/demo-parts.glb",
              "supplementCatalog": "/assets/demo-catalog-data.json", "nodes": nodes, "poses": poses, "restParts": rest,
              "partCount": len(parts), "jointCount": len(nodes) - len(parts),
              "sampling": "Uniform CTRL.transform parameter samples, t=0 aircraft, t=1 humanoid; matrices include mesh-origin compensation",
              "mechanismStatus": "Reference-based inferred pose study; hidden connections and swept collisions not validated",
              "sourceVideo": "https://www.douyin.com/video/7691906855547607370"}
    assert len(rest) == 77 and len(poses) == 11
    assert any(abs(a - b) > 0.01 for a, b in zip(poses[0]["nodes"][1]["worldMatrix"], poses[-1]["nodes"][1]["worldMatrix"]))
    atomic_json(PUBLIC / "transformer_demo.json", result)
    return {"parts": len(parts), "joints": len(nodes) - len(parts), "poses": len(poses), "supplement": supplement["statistics"]}


def export_assets(catalog, args):
    import bpy
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    source_collection = append_collection(ROOT / "output" / "parts_library.blend", "PartsLibrary")
    sources = {obj["partId"]: obj for obj in source_collection.all_objects if obj.get("asset_role")}
    assert len(sources) == 47
    scene = bpy.data.scenes.new("GameAssetExport")
    target = bpy.data.collections.new("Only canonical game meshes")
    scene.collection.children.link(target)
    bpy.context.window.scene = scene
    reports = []
    chosen_segments = 1
    for bevel_segments in (1, 0):
        for obj in list(target.objects):
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        objects = [create_export_mesh(sources[entry["id"]], entry, target, bevel_segments) for entry in catalog["parts"]]
        statistics = export_glb(scene, objects, catalog["parts"], "parts.glb")
        statistics["bevelSegments"] = bevel_segments
        reports.append(statistics)
        chosen_segments = bevel_segments
        if statistics["bytes"] < 8 * 1024 * 1024:
            break
    catalog["preliminary"] = False
    catalog["statistics"] = reports[-1]
    catalog["licenseFile"] = "/assets/LDraw-LICENSE.txt"
    for entry in catalog["parts"]:
        entry["triangles"] = reports[-1]["nodes"][entry["nodeName"]]["triangles"]
        entry["gltfVertices"] = reports[-1]["nodes"][entry["nodeName"]]["vertices"]
    atomic_json(PUBLIC / "catalog-data.json", catalog)
    license_text = "REAL LDRAW GAME ASSETS\n\nSource: https://library.ldraw.org/library/updates/complete.zip\n1 game unit = 1 stud. Geometry axis-converted, centred/grounded, with a small baked edge bevel.\n\n"
    for entry in catalog["parts"]:
        license_text += entry["id"] + " | " + entry["source"] + "\nAuthors: " + "; ".join(entry["authors"]) + "\n" + entry["license"] + "\n\n"
    license_text += "\n" + (ROOT / "ldraw" / "CAreadme.txt").read_text(encoding="utf-8-sig", errors="replace")
    (PUBLIC / "LDraw-LICENSE.txt").write_text(license_text, encoding="utf-8")
    report = {"main": reports[-1], "attempts": [{key: value for key, value in item.items() if key != "nodes"} for item in reports]}
    if not args.skip_demo:
        report["demo"] = export_demo(source_collection, scene, target, catalog, chosen_segments)
    atomic_json(PUBLIC / "asset-report.json", report)
    print("GAME_ASSETS_COMPLETE", json.dumps({key: value for key, value in report.items() if key != "main"}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--skip-demo", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)
    catalog = bootstrap_metadata()
    if args.metadata_only:
        print("GAME_CATALOG_METADATA_READY", len(catalog["parts"]), flush=True)
        return
    export_assets(catalog, args)


if __name__ == "__main__":
    main()
