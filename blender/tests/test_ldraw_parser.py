"""Dependency-free synthetic fixtures for the surface importer."""

import importlib.util
import math
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "ldraw_import.py"
SPEC = importlib.util.spec_from_file_location("ldraw_import", str(MODULE_PATH))
ldraw = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ldraw
SPEC.loader.exec_module(ldraw)


IDENTITY_REF = "1 {color} {translation} 1 0 0 0 1 0 0 0 1 {file}"
TRIANGLE = "3 16 0 0 0 20 0 0 0 20 0"


def normal(data, face_index=0):
    a, b, c = [data.vertices[i] for i in data.faces[face_index][:3]]
    ab, ac = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
    return (ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0])


class LDrawParserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ldraw-test-", dir=str(Path(__file__).resolve().parent))
        self.root = Path(self.temp.name)
        (self.root / "parts").mkdir()
        (self.root / "p").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def parse(self, name="test", color=71):
        return ldraw.LDrawParser(self.root).parse(name, color=color)

    def test_quad_weld_materials_metadata_and_original_origin(self):
        self.write("parts/test.dat", "\n".join([
            "0 Test physical part", "0 Author: Test Author [test]",
            "0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt",
            "0 BFC CERTIFY CCW",
            "4 16 0 0 0 20 0 0 20 0 20 0 0 20",
            "3 4 0 0 0 20 0 0 0 -24 0",
            "2 24 0 0 0 20 0 0", "5 24 0 0 0 20 0 0 0 1 0 0 -1 0",
            "3 24 0 0 0 20 0 0 0 20 0",
        ]))
        data = self.parse()
        self.assertEqual(len(data.faces[0]), 4)
        self.assertEqual(len(data.vertices), 5)
        self.assertEqual(data.face_colors, (71, 4))
        self.assertEqual(data.bbox, ((0.0, 0.0, 0.0), (1.0, 1.0, 1.2)))
        self.assertEqual(data.dimensions, (1.0, 1.0, 1.2))
        self.assertIn("Test Author [test]", data.metadata["authors"])
        self.assertIn("CC BY 4.0", data.metadata["license"])
        self.assertEqual(data.metadata["description"], "Test physical part")
        self.assertEqual(data.double_sided, (False, False))

    def test_nested_affine_transform_and_colour_inheritance(self):
        self.write("parts/test.dat", "0 Main\n0 BFC CERTIFY CCW\n"
                   "1 4 20 0 0 0 0 1 0 1 0 -1 0 0 s\\child.dat")
        self.write("parts/s/child.dat", "0 Child\n0 BFC CERTIFY CCW\n" +
                   IDENTITY_REF.format(color=16, translation="0 20 0", file="leaf.dat"))
        self.write("p/leaf.dat", "0 Leaf\n0 BFC CERTIFY CCW\n" + TRIANGLE)
        data = self.parse()
        self.assertEqual(set(data.vertices), {(1.0, 0.0, -1.0), (1.0, -1.0, -1.0), (1.0, 0.0, -2.0)})
        self.assertEqual(data.face_colors, (4,))
        self.assertEqual(data.metadata["source_files"], ["p/leaf.dat", "parts/s/child.dat", "parts/test.dat"])

    def test_mirror_correction_and_invertnext_cancel_separately(self):
        self.write("p/tri.dat", "0 Triangle\n0 BFC CERTIFY CCW\n" + TRIANGLE)
        self.write("parts/test.dat", "0 Main\n0 BFC CERTIFY CCW\n"
                   "1 16 0 0 0 -1 0 0 0 1 0 0 0 1 tri.dat\n"
                   "0 BFC INVERTNEXT\n\n"
                   "1 16 40 0 0 -1 0 0 0 1 0 0 0 1 tri.dat\n"
                   "1 16 80 0 0 -1 0 0 0 1 0 0 0 1 tri.dat")
        data = self.parse()
        self.assertGreater(normal(data, 0)[1], 0)
        self.assertLess(normal(data, 1)[1], 0)
        self.assertGreater(normal(data, 2)[1], 0)

    def test_cw_and_ccw_are_local_to_each_file(self):
        self.write("p/tri.dat", "0 Triangle\n0 BFC CERTIFY CCW\n" + TRIANGLE)
        self.write("parts/test.dat", "0 Main\n0 BFC CERTIFY CW\n" + TRIANGLE + "\n" +
                   IDENTITY_REF.format(color=16, translation="40 0 0", file="tri.dat"))
        data = self.parse()
        self.assertLess(normal(data, 0)[1], 0)
        self.assertGreater(normal(data, 1)[1], 0)

    def test_noclip_and_uncertified_files_remain_double_sided(self):
        self.write("parts/test.dat", "0 Main\n0 BFC CERTIFY CCW\n0 BFC NOCLIP\n" + TRIANGLE +
                   "\n0 BFC CLIP\n3 16 40 0 0 60 0 0 40 20 0")
        self.assertEqual(self.parse().double_sided, (True, False))
        self.write("parts/raw.dat", "0 Old part\n" + TRIANGLE)
        self.assertEqual(self.parse("raw").double_sided, (True,))

    def test_explicit_and_direct_colours_are_kept(self):
        self.write("parts/test.dat", "0 Main\n" + TRIANGLE +
                   "\n3 0x2FFAA00 40 0 0 60 0 0 40 20 0")
        self.assertEqual(self.parse().face_colors, (71, 0x2FFAA00))

    def test_library_paths_are_case_insensitive_and_cannot_escape(self):
        self.write("parts/Test.DAT", "0 Main\n" + TRIANGLE)
        self.assertEqual(len(self.parse("test").faces), 1)
        with self.assertRaisesRegex(ldraw.LDrawError, "inside"):
            self.parse("../outside")
        with self.assertRaisesRegex(ldraw.LDrawError, "Missing"):
            self.parse("missing")

    def test_cycles_and_malformed_geometry_fail(self):
        self.write("parts/test.dat", "0 Cycle\n" + IDENTITY_REF.format(color=16, translation="0 0 0", file="test.dat"))
        with self.assertRaisesRegex(ldraw.LDrawError, "Recursive"):
            self.parse()
        self.write("parts/bad.dat", "0 Bad\n3 16 0 0 0 20 0 0")
        with self.assertRaisesRegex(ldraw.LDrawError, "bad.dat:2"):
            self.parse("bad")
        self.write("parts/nan.dat", "0 Bad\n3 16 0 0 0 20 0 0 0 nan 0")
        with self.assertRaisesRegex(ldraw.LDrawError, "finite"):
            self.parse("nan")

    def test_welding_discards_collapsed_faces(self):
        self.write("parts/test.dat", "0 Main\n" + TRIANGLE +
                   "\n3 16 0 0 0 0.0000001 0 0 0 0 0" +
                   "\n3 16 1000 1000 1000 1000 1000 1000 1000 1000 1000")
        data = self.parse()
        self.assertEqual(len(data.vertices), 3)
        self.assertEqual(len(data.faces), 1)
        self.assertEqual(data.metadata["discarded_degenerate_faces"], 2)
        self.assertEqual(data.bbox, ((0.0, 0.0, -1.0), (1.0, 0.0, 0.0)))

    def test_official_palette_alpha_and_finish(self):
        self.write("LDConfig.ldr", "0 !COLOUR Test_Glass CODE 47 VALUE #FCFCFC EDGE #C3C3C3 ALPHA 128\n"
                   "0 !COLOUR Test_Chrome CODE 80 VALUE #AABBCC EDGE #000000 CHROME")
        colors = ldraw.read_ldconfig(self.root)
        self.assertAlmostEqual(colors[47]["alpha"], 128 / 255.0)
        self.assertEqual(colors[80]["color"], "#AABBCC")
        self.assertTrue(colors[80]["metallic"])


class BlenderImportSmokeTests(unittest.TestCase):
    def test_real_brick_and_beam(self):
        try:
            import bpy
        except ImportError:
            self.skipTest("Run inside Blender for real mesh-object integration")
        library = MODULE_PATH.parents[1] / "ldraw"
        if not (library / "parts" / "3001.dat").is_file():
            self.skipTest("Local official part fixtures have not been downloaded")
        collection = bpy.data.collections.new("LDraw importer test")
        bpy.context.scene.collection.children.link(collection)
        objects = []
        try:
            for part_id, expected in [("3001", (4.0, 2.0, 1.4)), ("32523", (0.9, 2.9, 1.0))]:
                obj = ldraw.import_part(part_id, library, collection, color=71)
                objects.append(obj)
                self.assertEqual(obj.type, "MESH")
                self.assertEqual(obj["partId"], part_id)
                self.assertIn("CC BY 4.0", obj["license"])
                self.assertGreater(len(obj.data.polygons), 100)
                self.assertEqual(len(obj.data.materials), 1)
                dimensions = tuple(max(v.co[i] for v in obj.data.vertices) - min(v.co[i] for v in obj.data.vertices)
                                   for i in range(3))
                for actual, wanted in zip(dimensions, expected):
                    self.assertAlmostEqual(actual, wanted, places=5)
                signed_volume = 0.0
                for face in obj.data.polygons:
                    a = obj.data.vertices[face.vertices[0]].co
                    for i in range(1, len(face.vertices) - 1):
                        b = obj.data.vertices[face.vertices[i]].co
                        c = obj.data.vertices[face.vertices[i + 1]].co
                        signed_volume += a.dot(b.cross(c)) / 6.0
                self.assertGreater(signed_volume, 0, "BFC-corrected surface orientation should give positive volume")
                print("LDRAW_BLENDER_SMOKE", part_id, len(obj.data.vertices), len(obj.data.polygons),
                      tuple(round(v, 5) for v in dimensions), round(signed_volume, 5))
            self.assertEqual(len(collection.objects), 2)
        finally:
            for obj in objects:
                mesh = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                bpy.data.meshes.remove(mesh)
            bpy.data.collections.remove(collection)


if __name__ == "__main__":
    unittest.main()
