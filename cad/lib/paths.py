"""Shared locations for the SLDP CAD scripts, so no script depends on copies of files beside it.

Each drawing script starts with:
    import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
which makes paths.py, hlr.py, sldp_sheet.py and asm.py importable from cad/lib/.
Model scripts write their STL/STEP next to themselves; drawing scripts read them from there.
"""
import os, importlib.util

CAD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K9 = os.path.join(CAD, 'vendor', 'k9-gimbal')            # K-9 TVC gimbal V7 + motor tube V8 (public domain)
ST005 = os.path.join(CAD, 'ST-005_rocket-body')
AV001 = os.path.join(CAD, 'AV-001_avionic-sled')
TVC001 = os.path.join(CAD, 'TVC-001_tvc-mount')
GA001 = os.path.join(CAD, 'GA-001_rocket-ga')

K9_FILES = {'outer': 'K-9_TVC_Gimbal_V7_Outer_Gimbal.stl',
            'inner': 'K-9_TVC_Gimbal_V7_Inner_Gimbal.stl',
            'tube': 'Motor_Tube_V8.stl'}


def load_module(path, name):
    """Import a script whose file name has hyphens (e.g. SLDP-ST-005_rocket-body.py)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def body_model():
    return load_module(os.path.join(ST005, 'SLDP-ST-005_rocket-body.py'), 'body_model')


def sled_model():
    return load_module(os.path.join(AV001, 'SLDP-AV-001_avionic-sled.py'), 'sled_model')
