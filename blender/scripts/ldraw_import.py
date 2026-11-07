"""Small LDraw surface importer for the project's Blender scene builder.

Pure Python API::

    data = LDrawParser(library_dir).parse("3001", color=71)
    # data.vertices, data.faces, data.face_colors, data.bbox, data.metadata

Blender API::

    obj = import_part("3001", library_dir, collection, color=71,
                      location=(0, 0, 1.2), name="Body brick")

One Blender unit is one stud pitch (20 LDU). Vertices map as
``(x / 20, z / 20, -y / 20)``. The LDraw part origin is retained: a standard
brick's body extends downwards from its top-face origin. No centering, grounding,
modifiers, triangulation or normal recalculation is applied automatically.
Location is in Blender units and rotation is a Blender XYZ Euler in radians.

LDraw types 1/3/4 and BFC CW/CCW, INVERTNEXT, CLIP/NOCLIP are supported.
Types 2/5 and colour-24 geometry are omitted. Colour 16 inherits recursively.
File lookup is confined to the supplied local library (parts/, p/, and relative
subfiles); missing dependencies, cycles and malformed surface commands fail
loudly instead of silently yielding incomplete parts. No download is performed.

Specification references:
https://www.ldraw.org/article/218.html
https://www.ldraw.org/article/415.html

shortcut: TEXMAP, MPD and embedded image data are not decoded; add those when
importing patterned/textured parts or multi-part model documents.
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


LDU_PER_STUD = 20.0
IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
ZERO = (0.0, 0.0, 0.0)


class LDrawError(ValueError):
    """A local LDraw file or its dependency graph could not be imported."""


@dataclass(frozen=True)
class MeshData:
    vertices: tuple
    faces: tuple
    face_colors: tuple
    double_sided: tuple
    bbox: object
    metadata: dict

    @property
    def dimensions(self):
        if self.bbox is None:
            return (0.0, 0.0, 0.0)
        return tuple(self.bbox[1][i] - self.bbox[0][i] for i in range(3))


def _multiply(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3))
                       for j in range(3)) for i in range(3))


def _apply(matrix, point, translation=ZERO):
    return tuple(sum(matrix[i][j] * point[j] for j in range(3))
                 + translation[i] for i in range(3))


def _determinant(m):
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _colour(token):
    value = int(token, 16) if token.lower().startswith("0x") else int(token)
    if value < 0:
        raise ValueError("colour cannot be negative")
    return value


def _safe_name(value):
    name = str(value).strip().replace("\\", "/")
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ":" in name or ".." in path.parts:
        raise LDrawError("Subfile paths must remain inside the LDraw library: " + name)
    if not path.suffix:
        path = path.with_suffix(".dat")
    return str(path)


def _number_tokens(tokens):
    values = tuple(float(token) for token in tokens)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("coordinates and matrices must be finite")
    return values


class LDrawParser:
    """Resolve and flatten one physical part, preserving its original origin.

    ``weld_tolerance`` is a rounding grid in stud units, used only for duplicate
    vertex keys; the original coordinates of the first matching vertex remain.
    The library must already contain all recursively referenced .dat files.
    """

    def __init__(self, library_dir, weld_tolerance=1e-6, max_depth=64):
        self.library_dir = Path(library_dir).resolve()
        if not self.library_dir.is_dir():
            raise LDrawError("LDraw library directory does not exist: " + str(self.library_dir))
        if not math.isfinite(weld_tolerance) or weld_tolerance <= 0:
            raise ValueError("weld_tolerance must be positive and finite")
        self.weld_tolerance = weld_tolerance
        self.max_depth = max_depth
        self._files = {}
        self._paths = {}

    def _inside_library(self, path):
        try:
            path.relative_to(self.library_dir)
            return True
        except ValueError:
            return False

    def resolve(self, filename, parent=None):
        name = _safe_name(filename)
        key = (name.lower(), str(parent) if parent else "")
        if key in self._paths:
            return self._paths[key]
        bases = [self.library_dir / "parts", self.library_dir / "p", self.library_dir]
        if parent is not None:
            bases.append(Path(parent).parent)
        for base in bases:
            candidate = (base / name).resolve()
            if not self._inside_library(candidate):
                continue
            if candidate.is_file():
                self._paths[key] = candidate
                return candidate
            # Official references are case-insensitive; also work on Linux hosts.
            current = base
            for segment in PurePosixPath(name).parts:
                if not current.is_dir():
                    break
                match = next((p for p in current.iterdir() if p.name.lower() == segment.lower()), None)
                if match is None:
                    break
                current = match
            else:
                current = current.resolve()
                if current.is_file() and self._inside_library(current):
                    self._paths[key] = current
                    return current
        referring = " referenced by " + str(parent) if parent else ""
        raise LDrawError("Missing LDraw dependency: " + name + referring)

    def _read(self, path):
        if path not in self._files:
            raw = path.read_bytes()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("cp1252")
            self._files[path] = tuple(text.splitlines())
        return self._files[path]

    def parse(self, part_id, color=16):
        """Return immutable geometry tuples with a single colour ID per face."""
        main_colour = _colour(str(color))
        if main_colour == 24:
            raise LDrawError("Colour 24 is an edge colour and cannot colour a surface part")
        root = self.resolve(part_id)
        vertices, faces, colors, two_sided = [], [], [], []
        welded = {}
        files, authors, licenses = set(), set(), set()
        description = ""
        discarded = 0

        def add_face(points, face_color, double_sided):
            nonlocal discarded
            indices = []
            for x, y, z in points:
                vertex = (x / LDU_PER_STUD, z / LDU_PER_STUD, -y / LDU_PER_STUD)
                key = tuple(round(value / self.weld_tolerance) for value in vertex)
                if key not in welded:
                    welded[key] = len(vertices)
                    vertices.append(vertex)
                index = welded[key]
                if not indices or index != indices[-1]:
                    indices.append(index)
            if len(indices) > 1 and indices[0] == indices[-1]:
                indices.pop()
            if len(set(indices)) < 3:
                discarded += 1
                return
            # Newell's normal detects zero-area triangles and collapsed quads.
            normal = [0.0, 0.0, 0.0]
            for i, index in enumerate(indices):
                a, b = vertices[index], vertices[indices[(i + 1) % len(indices)]]
                normal[0] += (a[1] - b[1]) * (a[2] + b[2])
                normal[1] += (a[2] - b[2]) * (a[0] + b[0])
                normal[2] += (a[0] - b[0]) * (a[1] + b[1])
            if sum(value * value for value in normal) <= self.weld_tolerance ** 4:
                discarded += 1
                return
            faces.append(tuple(indices))
            colors.append(face_color)
            two_sided.append(double_sided)

        def visit(path, matrix, translation, inherited_colour, inverted, cull_allowed, stack):
            nonlocal description
            if path in stack:
                raise LDrawError("Recursive LDraw dependency: " + " -> ".join(p.name for p in stack + (path,)))
            if len(stack) >= self.max_depth:
                raise LDrawError("LDraw dependency depth exceeds " + str(self.max_depth))
            stack = stack + (path,)
            files.add(path.relative_to(self.library_dir).as_posix())
            certified, no_certify, clip, clockwise, invert_next = False, False, True, False, False
            operational = False
            mirrored = _determinant(matrix) < 0
            lines = self._read(path)
            for line_number, line in enumerate(lines, 1):
                text = line.strip()
                if not text:
                    continue
                tokens = text.split()
                try:
                    line_type = int(tokens[0])
                except ValueError:
                    continue
                if line_type == 0:
                    if path == root and line_number == 1:
                        description = text[1:].strip()
                    if len(tokens) >= 2 and tokens[1] == "Author:":
                        authors.add(text.split("Author:", 1)[1].strip())
                    if len(tokens) >= 2 and tokens[1] == "!LICENSE":
                        licenses.add(text.split("!LICENSE", 1)[1].strip())
                    if len(tokens) >= 3 and tokens[1] == "BFC":
                        options = tokens[2:]
                        if "NOCERTIFY" in options:
                            no_certify, certified = True, False
                        if no_certify:
                            continue
                        if "CERTIFY" in options or not operational:
                            certified = True
                        if "CW" in options:
                            clockwise = True
                        if "CCW" in options:
                            clockwise = False
                        if "NOCLIP" in options:
                            clip = False
                        if "CLIP" in options:
                            clip = True
                        if "INVERTNEXT" in options:
                            invert_next = True
                    continue
                if line_type not in (1, 2, 3, 4, 5):
                    continue
                operational = True
                invert_this = invert_next
                invert_next = False
                if line_type in (2, 5):
                    continue
                try:
                    if line_type == 1:
                        fields = text.split(None, 14)
                        if len(fields) != 15:
                            raise ValueError("type 1 needs colour, 12 numbers and a subfile name")
                        reference_color = _colour(fields[1])
                        if reference_color == 24:
                            continue
                        child_color = inherited_colour if reference_color == 16 else reference_color
                        values = _number_tokens(fields[2:14])
                        child_translation = _apply(matrix, values[:3], translation)
                        child_matrix = tuple(tuple(values[3 + i * 3 + j] for j in range(3)) for i in range(3))
                        child = self.resolve(fields[14], path)
                        visit(child, _multiply(matrix, child_matrix), child_translation,
                              child_color, inverted ^ (invert_this and certified),
                              cull_allowed and certified and clip, stack)
                    else:
                        count = 3 if line_type == 3 else 4
                        if len(tokens) != 2 + count * 3:
                            raise ValueError("type %s needs exactly %s vertex coordinates" % (line_type, count * 3))
                        face_color = _colour(tokens[1])
                        if face_color == 24:
                            continue
                        face_color = inherited_colour if face_color == 16 else face_color
                        values = _number_tokens(tokens[2:])
                        points = [_apply(matrix, values[i:i + 3], translation) for i in range(0, len(values), 3)]
                        if mirrored ^ inverted ^ (clockwise and certified):
                            points.reverse()
                        add_face(points, face_color, not (cull_allowed and certified and clip))
                except (ValueError, OSError) as error:
                    raise LDrawError("%s:%s: %s" % (path.name, line_number, error)) from error

        visit(root, IDENTITY, ZERO, main_colour, False, True, ())
        used = {index for face in faces for index in face}
        if len(used) != len(vertices):
            kept = [index for index in range(len(vertices)) if index in used]
            remap = {old: new for new, old in enumerate(kept)}
            vertices = [vertices[index] for index in kept]
            faces = [tuple(remap[index] for index in face) for face in faces]
        bbox = None
        if vertices:
            bbox = (tuple(min(v[i] for v in vertices) for i in range(3)),
                    tuple(max(v[i] for v in vertices) for i in range(3)))
        relative = root.relative_to(self.library_dir).as_posix()
        metadata = {
            "part_id": root.stem,
            "description": description,
            "source": relative,
            "source_url": "https://library.ldraw.org/library/official/" + relative,
            "source_files": sorted(files),
            "authors": sorted(authors),
            "licenses": sorted(licenses),
            "license": "; ".join(sorted(licenses)) or "Unspecified in source file",
            "unit": "1 Blender unit = 1 stud = 20 LDU",
            "origin": "Original LDraw origin; not centered or grounded",
            "discarded_degenerate_faces": discarded,
        }
        return MeshData(tuple(vertices), tuple(faces), tuple(colors), tuple(two_sided), bbox, metadata)


def read_ldconfig(library_dir):
    """Read official !COLOUR values when LDConfig.ldr is present locally."""
    path = Path(library_dir) / "LDConfig.ldr"
    if not path.is_file():
        path = Path(library_dir) / "ldconfig.ldr"
    if not path.is_file():
        return {}
    palette = {}
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        tokens = line.split()
        if len(tokens) < 7 or tokens[:2] != ["0", "!COLOUR"]:
            continue
        try:
            code = int(tokens[tokens.index("CODE") + 1])
            value = tokens[tokens.index("VALUE") + 1]
            alpha = int(tokens[tokens.index("ALPHA") + 1]) / 255.0 if "ALPHA" in tokens else 1.0
            palette[code] = {"color": value, "alpha": alpha, "name": tokens[2],
                             "metallic": any(t in tokens for t in ("CHROME", "METAL", "MATTE_METALLIC"))}
        except (ValueError, IndexError):
            continue
    return palette


def _rgba(value):
    if isinstance(value, str):
        text = value.lstrip("#")
        if len(text) not in (6, 8):
            raise ValueError("Colours must be #RRGGBB or #RRGGBBAA")
        result = tuple(int(text[i:i + 2], 16) / 255.0 for i in range(0, len(text), 2))
    else:
        result = tuple(float(c) for c in value)
    if len(result) == 3:
        result = result + (1.0,)
    if len(result) != 4 or not all(math.isfinite(c) and 0 <= c <= 1 for c in result):
        raise ValueError("Colour components must be finite values between 0 and 1")
    return result


def _linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _make_material(bpy, code, value):
    if isinstance(value, bpy.types.Material):
        return value
    settings = value if isinstance(value, dict) else {"color": value}
    rgba = _rgba(settings["color"])
    rgba = rgba[:3] + (float(settings.get("alpha", rgba[3])),)
    if not 0 <= rgba[3] <= 1 or not math.isfinite(rgba[3]):
        raise ValueError("Material alpha must be between 0 and 1")
    name = "LDraw %s %s" % (code, "-".join(str(round(c * 255)) for c in rgba))
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    linear = tuple(_linear(c) for c in rgba[:3]) + (rgba[3],)
    material.diffuse_color = linear
    shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = linear
    shader.inputs["Roughness"].default_value = 0.28
    shader.inputs["Metallic"].default_value = 0.65 if settings.get("metallic") else 0.0
    shader.inputs["Alpha"].default_value = rgba[3]
    if rgba[3] < 1 and "Transmission Weight" in shader.inputs:
        shader.inputs["Transmission Weight"].default_value = 0.7
    material["ldraw_color_id"] = code
    return material


def import_part(part_id, library_dir, collection=None, color=16, material=None,
                palette=None, name=None, location=ZERO, rotation=ZERO):
    """Create one mesh object for one complete physical LDraw part.

    ``color`` can be a LDraw integer ID, #RRGGBB, RGB(A) sRGB sequence, or a
    Blender Material. ``material`` overrides the inherited main-colour slot.
    ``palette`` maps integer colour IDs to Blender materials, sRGB colour values,
    or {"color": "#RRGGBB", "alpha": 1.0} dictionaries. Explicit secondary
    colours keep distinct material slots. LDConfig.ldr supplies missing values.
    """
    import bpy

    location, rotation = tuple(location), tuple(rotation)
    if any(len(value) != 3 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in value)
           for value in (location, rotation)):
        raise ValueError("location and rotation must contain three finite numbers")
    if isinstance(color, bpy.types.Material):
        material, main_color = color, 16
        main_value = None
    elif isinstance(color, int):
        main_color, main_value = color, None
    else:
        main_color, main_value = 16, color
    parser = LDrawParser(library_dir)
    data = parser.parse(part_id, color=main_color)
    if not data.faces:
        raise LDrawError("Part has no importable surface faces: " + str(part_id))
    values = read_ldconfig(library_dir)
    values.update(palette or {})
    if main_value is not None:
        values[main_color] = main_value
    if material is not None:
        values[main_color] = material
    mesh = bpy.data.meshes.new((name or str(part_id)) + "_mesh")
    mesh.from_pydata(data.vertices, [], data.faces)
    mesh.update()
    slots = {}
    unknown = []
    obj = None
    try:
        for code in dict.fromkeys(data.face_colors):
            value = values.get(code, values.get(str(code)))
            if value is None and 0x2000000 <= code <= 0x2FFFFFF:
                value = "#%06X" % (code & 0xFFFFFF)
            if value is None:
                value = "#808080"
                unknown.append(code)
            slots[code] = len(mesh.materials)
            mesh.materials.append(_make_material(bpy, code, value))
        for polygon, code in zip(mesh.polygons, data.face_colors):
            polygon.material_index = slots[code]
        obj = bpy.data.objects.new(name or (data.metadata["part_id"] + " - " + data.metadata["description"]), mesh)
        (collection or bpy.context.collection).objects.link(obj)
        obj.location = location
        obj.rotation_euler = rotation
        obj["partId"] = data.metadata["part_id"]
        obj["description"] = data.metadata["description"]
        obj["source"] = data.metadata["source_url"]
        obj["license"] = data.metadata["license"]
        obj["ldraw_metadata"] = json.dumps(data.metadata, ensure_ascii=False)
        obj["ldraw_unknown_color_ids"] = json.dumps(unknown)
        obj["ldraw_origin"] = data.metadata["origin"]
        obj["ldraw_units_per_stud"] = LDU_PER_STUD
        obj["ldraw_double_sided_faces"] = sum(data.double_sided)
        return obj
    except Exception:
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        raise
