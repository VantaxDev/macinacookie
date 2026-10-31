#!/usr/bin/env python3
"""Build a reproducible extension-only ZIP using a reviewed file allowlist."""
import hashlib, json, pathlib, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
EXT=ROOT/'extension'
FILES=['manifest.json','service-worker.js','core.js','background.js','dashboard.html','dashboard.css','dashboard.js','popup.html','popup.js','icons/cookie.svg',*[f'icons/cookie-{n}.png' for n in [16,32,48,128]]]
manifest=json.loads((EXT/'manifest.json').read_text())
assert manifest['manifest_version']==3
assert manifest['permissions']==['cookies','storage','alarms']
assert manifest['incognito']=='not_allowed'
out=ROOT/'dist'/f'macinacookie-chrome-{manifest["version"]}.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in sorted(FILES):
        path=EXT/name
        assert path.is_file() and not path.is_symlink(),name
        info=zipfile.ZipInfo(name,date_time=(2026,10,31,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644<<16
        z.writestr(info,path.read_bytes())
print(out)
print('SHA256',hashlib.sha256(out.read_bytes()).hexdigest())
