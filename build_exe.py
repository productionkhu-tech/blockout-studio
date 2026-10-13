"""exe 만들기 — python build_exe.py  →  _배포\\블록아웃 스튜디오\\블록아웃 스튜디오.exe (+ assets 폴더는 옆에 복사, 없어도 됨)
PyInstaller 로 launcher.py 를 한 파일로 묶고 index.html · app · vendor · 공개 장면 · version.json · 읽어보기.txt 를 안에 넣는다. 아이콘은 icon.ico(없으면 만듦).
GitHub 릴리스용: _배포\\release\\BlockoutStudio.exe(앱이 업데이트로 받는 이름) · BlockoutStudio-v<판>-windows.zip(exe + 읽어보기) · .mcpb
버전은 version.json 하나 — 올리고 빌드 → github 릴리스 태그 v<판> 에 BlockoutStudio.exe 를 올리면 쓰는 사람의 앱이 다음에 켤 때 바뀐다."""
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "_배포", "블록아웃 스튜디오")
WORK = os.path.join(ROOT, "_배포", "_build")
NAME = "블록아웃 스튜디오"
RELEASE = os.path.join(ROOT, "_배포", "release")
PRIVATE_SCENES = {"승강로_v9.json"}                  # 공개 판에 넣지 않는 예시(파일이 없으면 앱이 그 세트를 숨김)
VINFO = json.load(open(os.path.join(ROOT, "version.json"), encoding="utf-8"))
VERSION = VINFO["version"]


def make_icon(path):
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8, 8, 248, 248), radius=52, fill=(24, 24, 26, 255))
    d.rounded_rectangle((44, 92, 212, 196), radius=18, fill=(255, 104, 32, 255))            # 카메라 몸통
    d.rounded_rectangle((92, 60, 164, 100), radius=10, fill=(255, 104, 32, 255))            # 위 돌출
    d.ellipse((96, 112, 176, 192), fill=(24, 24, 26, 255))                                  # 렌즈
    d.ellipse((112, 128, 160, 176), fill=(255, 104, 32, 255))
    d.ellipse((126, 142, 146, 162), fill=(24, 24, 26, 255))
    img.save(path, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])


def main():
    icon = os.path.join(ROOT, "icon.ico")
    if not os.path.exists(icon):
        make_icon(icon)
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)
    sep = ";" if os.name == "nt" else ":"
    scenes = [(os.path.join("scenes", f), "scenes") for f in sorted(os.listdir(os.path.join(ROOT, "scenes"))) if f.endswith(".json") and f not in PRIVATE_SCENES]
    data = [("index.html", "."), ("app", "app"), ("vendor", "vendor"), ("version.json", "."), ("읽어보기.txt", "."), ("LICENSE", ".")] + scenes
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--onefile", "--noconsole", "--name", NAME, "--icon", icon,
           "--distpath", OUT, "--workpath", WORK, "--specpath", WORK, "--clean"]
    for src, dst in data:
        cmd += ["--add-data", f"{os.path.join(ROOT, src)}{sep}{dst}"]
    cmd.append(os.path.join(ROOT, "launcher.py"))
    print(" ".join(cmd))
    subprocess.check_call(cmd, cwd=ROOT)
    # 옆에 두는 것들
    assets = os.path.join(ROOT, "assets")
    if os.path.isdir(assets):
        dst = os.path.join(OUT, "assets")
        os.makedirs(dst, exist_ok=True)
        for f in os.listdir(assets):
            if f.lower().endswith(".glb") and not os.path.exists(os.path.join(dst, f)):
                shutil.copy2(os.path.join(assets, f), dst)
    shutil.copy2(os.path.join(ROOT, "읽어보기.txt"), OUT)
    exe = os.path.join(OUT, NAME + ".exe")
    print("OK", exe, "%.1f MB" % (os.path.getsize(exe) / 1048576))
    print("OK", make_mcpb(exe))
    print("OK", make_release(exe))


def make_release(exe):
    """GitHub 릴리스에 올릴 것 — 영문 이름 exe(업데이트가 받는 이름) · latest.json(앱이 보는 설명표: 판·크기·SHA-256·바뀐 점) · zip(exe + 읽어보기) · Claude 확장.
    assets(큰 모델)는 넣지 않음. latest.json 이 없으면 앱은 받은 exe 를 끼우지 않으니(검증 불가) 꼭 같이 올릴 것."""
    import hashlib
    os.makedirs(RELEASE, exist_ok=True)
    out = os.path.join(RELEASE, "BlockoutStudio.exe")
    shutil.copy2(exe, out)
    with open(out, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    latest = {"version": VERSION, "date": VINFO.get("date", ""), "asset": "BlockoutStudio.exe", "size": os.path.getsize(out), "sha256": sha, "notes": VINFO.get("notes", [])}
    with open(os.path.join(RELEASE, "latest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)
    z = os.path.join(RELEASE, f"BlockoutStudio-v{VERSION}-windows.zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as f:
        f.write(exe, f"블록아웃 스튜디오/{NAME}.exe")
        f.write(os.path.join(ROOT, "읽어보기.txt"), "블록아웃 스튜디오/읽어보기.txt")
        f.write(os.path.join(ROOT, "LICENSE"), "블록아웃 스튜디오/LICENSE.txt")
    shutil.copy2(os.path.join(ROOT, "_배포", "블록아웃 스튜디오 - Claude 확장.mcpb"), os.path.join(RELEASE, "BlockoutStudio-Claude.mcpb"))
    return f"{RELEASE} (exe {os.path.getsize(out) / 1048576:.1f} MB · zip {os.path.getsize(z) / 1048576:.1f} MB)"


def make_mcpb(exe):
    """Claude 데스크톱 확장(.mcpb) — 두 번 클릭하면 Claude 데스크톱이 설치. 안의 exe 사본을 --mcp 로 띄우고, 앱이 꺼져 있으면 그 사본이 창을 띄운다.
    도구 목록은 앱이 실행 중에 알려 주므로(tools_generated) 여기 적는 tools 는 소개용."""
    import json
    import re
    import zipfile
    from PIL import Image
    version = VERSION
    reg = json.load(open(os.path.join(ROOT, "app", "mcp_registry.json"), encoding="utf-8"))
    png = os.path.join(WORK, "icon.png")
    Image.open(os.path.join(ROOT, "icon.ico")).convert("RGBA").resize((256, 256)).save(png)
    manifest = {
        "manifest_version": "0.3",
        "name": "blockout-studio",
        "display_name": "블록아웃 스튜디오",
        "version": version,
        "description": "말로 시키면 열려 있는 블록아웃 스튜디오(회색 3D 프리비즈) 창에 바로 만들어 줍니다 — 물체·사람 동선·카메라 무빙·그림 확인·MP4/블렌더 내보내기.",
        "long_description": "블록아웃 스튜디오는 회색 3D 로 카메라 무빙과 동선을 잡아 보는 '어린이 블렌더'입니다. 이 확장을 깔면 Claude 가 앱 창을 직접 고칩니다. "
                            "앱이 꺼져 있으면 첫 명령 때 창이 열리고, AI 가 한 일은 앱에서 Ctrl+Z 로 되돌릴 수 있습니다. 저장한 파일은 문서\\블록아웃 스튜디오.",
        "author": {"name": "productionkhu-tech", "url": "https://github.com/productionkhu-tech/blockout-studio"},
        "server": {"type": "binary", "entry_point": "server/blockout-studio.exe",
                   "mcp_config": {"command": "${__dirname}/server/blockout-studio.exe", "args": ["--mcp"], "env": {}}},
        "tools": [{"name": c["name"], "description": c.get("title") or c["name"]} for c in reg.get("commands", [])] + [{"name": "get_guide", "description": "설명서 읽기"}],
        "tools_generated": True,
        "prompts_generated": True,
        "compatibility": {"platforms": ["win32"]},
        "icon": "icon.png",
    }
    out = os.path.join(ROOT, "_배포", "블록아웃 스튜디오 - Claude 확장.mcpb")
    with zipfile.ZipFile(out + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.write(exe, "server/blockout-studio.exe")
        z.write(png, "icon.png")
    os.replace(out + ".tmp", out)
    return f"{out} {os.path.getsize(out) / 1048576:.1f} MB"


if __name__ == "__main__":
    main()
