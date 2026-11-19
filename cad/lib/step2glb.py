"""STEP assembly -> GLB for the bench view. Each leaf part becomes one mesh node named "<group>|<colour>|<part name>".
Coordinates: STEP mm, z = rocket axis, 0 at the tail -> glTF (y, z, x) mm (scene: rocket +X is +Z, +Y is +X, z is up).
Groups: rocket (moves with the rocket, origin tail), inner (TVC inner gimbal + riding servo, about the gimbal point),
tube (motor tube, about the gimbal point), middle (rig middle ring, about the pivot), fixed (rig outer ring/arm/base).
usage: python step2glb.py in.step out.glb [linear_deflection_mm]
"""
import sys, json, struct, numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_Label
from OCP.OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
from OCP.TDataStd import TDataStd_Name
from OCP.TopLoc import TopLoc_Location
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

src, out = sys.argv[1], sys.argv[2]
LIN = float(sys.argv[3]) if len(sys.argv) > 3 else 0.15
doc = TDocStd_Document(TCollection_ExtendedString('XmlOcaf'))
r = STEPCAFControl_Reader(); r.SetNameMode(True)
assert r.ReadFile(src) == 1, 'read failed'
r.Transfer(doc)
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())

def name(lab):
    a = TDataStd_Name()
    return a.Get().ToExtString() if lab.FindAttribute(TDataStd_Name.GetID_s(), a) else ''

leaves = []   # (path names, shape located)
def walk(lab, loc, path):
    if st.IsReference_s(lab):
        ref = TDF_Label(); st.GetReferredShape_s(lab, ref)
        walk(ref, loc.Multiplied(st.GetLocation_s(lab)), path)
        return
    nm = name(lab)
    if st.IsAssembly_s(lab):
        comps = TDF_LabelSequence(); st.GetComponents_s(lab, comps)
        for i in range(1, comps.Length() + 1):
            walk(comps.Value(i), loc, path + [nm])
    else:
        leaves.append((path + [nm], st.GetShape_s(lab).Moved(loc)))

roots = TDF_LabelSequence(); st.GetFreeShapes(roots)
for i in range(1, roots.Length() + 1):
    walk(roots.Value(i), TopLoc_Location(), [])

def classify(path, center):
    n = path[-1]; p = ' / '.join(path)
    x, y, z = center
    if n.startswith('Inner gimbal') or n.startswith('Servo X'): return 'inner', 'gimbal' if n.startswith('Inner') else 'servo'
    if n.startswith('Motor tube'): return 'tube', 'tube'
    if n.startswith('Outer gimbal'): return 'rocket', 'gimbal'
    if n.startswith('Servo Y'): return 'rocket', 'servo'
    if n.startswith('3 Middle ring'): return 'middle', 'pla'
    if n.startswith(('4 Outer ring', '5 Arm', '6 Base')): return 'fixed', 'pla' if n.startswith('4') else 'pla2'
    if n.startswith(('1 Collar', '2 Pivot tab')): return 'rocket', 'pla'
    if 'Hardware' in p or n.startswith(('Head/nut', 'M3x')):
        # On the inner pivot axis (rig x, through the pivot): goes with the middle ring. On the outer axis (rig y): fixed.
        if abs(z - 247) < 6 and abs(y) < 6: return 'middle', 'steel'
        if abs(z - 247) < 6 and abs(x) < 6: return 'fixed', 'steel'
        return 'rocket', 'steel'
    key = {'A ': 'steel_body', 'B ': 'steel_body', 'C1': 'steel_band', 'C2': 'steel_band', 'G ': 'steel_door',
           'D ': 'black', 'E ': 'black', 'H ': 'black'}
    for k, c in key.items():
        if n.startswith(k): return 'rocket', c
    if 'sled' in n.lower(): return 'rocket', 'sled'
    return 'rocket', 'pla'

meshes = []
for path, shp in leaves:
    bb = Bnd_Box(); BRepBndLib.Add_s(shp, bb)
    p0, p1 = bb.CornerMin(), bb.CornerMax(); x0, y0, z0, x1, y1, z1 = p0.X(), p0.Y(), p0.Z(), p1.X(), p1.Y(), p1.Z()
    center = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    diag = ((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) ** 0.5
    lin = min(LIN, max(0.03, diag * 0.01))           # small parts (screws) get a finer absolute tolerance, but few faces
    BRepMesh_IncrementalMesh(shp, lin, False, 0.18, True)
    P, I = [], []
    ex = TopExp_Explorer(shp, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face(ex.Current()); loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, loc)
        if tri is not None:
            tr = loc.Transformation(); base = len(P)
            for k in range(1, tri.NbNodes() + 1):
                q = tri.Node(k).Transformed(tr); P.append((q.Y(), q.Z(), q.X()))
            rev = f.Orientation() == TopAbs_REVERSED
            for k in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(k).Get()
                I.append((base + a - 1, base + c - 1, base + b - 1) if rev else (base + a - 1, base + b - 1, base + c - 1))
        ex.Next()
    if not I: continue
    grp, col = classify(path, center)
    meshes.append((f'{grp}|{col}|{path[-1]}', np.array(P, np.float32), np.array(I, np.uint32)))

# ---- GLB ----
bin_ = bytearray(); views, accs, gmeshes, nodes = [], [], [], []
def add(data, target):
    while len(bin_) % 4: bin_.append(0)
    off = len(bin_); bin_.extend(data.tobytes())
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': data.nbytes, 'target': target})
    return len(views) - 1
tris = 0
for nm, P, I in meshes:
    small = len(P) < 65536
    idx = I.astype(np.uint16 if small else np.uint32)
    pv = add(P, 34962); iv = add(idx.reshape(-1), 34963)
    accs.append({'bufferView': pv, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()})
    accs.append({'bufferView': iv, 'componentType': 5123 if small else 5125, 'count': idx.size, 'type': 'SCALAR'})
    gmeshes.append({'primitives': [{'attributes': {'POSITION': len(accs) - 2}, 'indices': len(accs) - 1}]})
    nodes.append({'name': nm, 'mesh': len(gmeshes) - 1})
    tris += len(I)
gltf = {'asset': {'version': '2.0', 'generator': 'step2glb (SLDP 45)'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes, 'meshes': gmeshes, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(bin_) % 4: bin_.append(0)
with open(out, 'wb') as fh:
    fh.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
    fh.write(struct.pack('<II', len(js), 0x4E4F534A)); fh.write(js)
    fh.write(struct.pack('<II', len(bin_), 0x004E4942)); fh.write(bin_)
from collections import Counter
print(f'{len(meshes)} parts, {tris} triangles, {(len(bin_) + len(js)) / 1e6:.1f} MB')
print(Counter(m[0].split('|')[0] for m in meshes))
for nm, P, I in meshes: print(f'  {nm:55s} {len(I):7d} tris')
