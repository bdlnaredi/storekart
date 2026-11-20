"""Builds the Windows app: dist/<App>/<App>.exe and its files, ready for the installer (installer.iss).

Runs on Windows (GitHub Actions does it for you):  pip install pyinstaller pystray pillow
                                                   python windows/build.py
Optional environment: STORE_URL / STORE_NAME (StoreKart: the address and name built in), BUILD_NUMBER.
Prints the version on the last line as  VERSION=<x.y.z.n>.
"""
import json
import os
import re
import shutil
import subprocess
import sys

W = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(W)
APP = json.load(open(os.path.join(W, "app.json"), encoding="utf-8"))
NAME = APP["name"]
SEP = os.pathsep


def version():
    if APP["kind"] == "python":
        m = re.search(r'VERSION = "([\d.]+)"', open(os.path.join(ROOT, "app", "main.py"), encoding="utf-8").read())
        v = m.group(1)
    else:
        v = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))["version"]
    parts = (v.split(".") + ["0", "0"])[:3]
    return ".".join(parts + [os.environ.get("BUILD_NUMBER", "0")])


def main():
    dist_root = os.path.join(ROOT, "dist")
    work = os.path.join(ROOT, "build")
    shutil.rmtree(os.path.join(dist_root, NAME), ignore_errors=True)
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--name", NAME,
           "--icon", os.path.join(W, "app.ico"), "--distpath", dist_root, "--workpath", os.path.join(work, "pyi"),
           "--specpath", work, "--paths", W,
           "--add-data", os.path.join(W, "app.json") + SEP + ".", "--add-data", os.path.join(W, "app.ico") + SEP + ".",
           "--hidden-import", "pystray._win32", "--hidden-import", "PIL.Image", "--hidden-import", "segno"]
    if APP["kind"] == "python":
        src = os.path.join(ROOT, "app")
        cmd += ["--paths", src, "--add-data", os.path.join(src, "static") + SEP + "static"]
        for f in sorted(os.listdir(src)):
            if f.endswith(".py"):
                cmd += ["--hidden-import", f[:-3]]
    cmd.append(os.path.join(W, "winapp.py"))
    print(" ".join(cmd), flush=True)
    subprocess.check_call(cmd)

    out = os.path.join(dist_root, NAME)
    app = dict(APP)
    if os.environ.get("STORE_NAME", "").strip():
        app["title"] = os.environ["STORE_NAME"].strip()
    with open(os.path.join(out, "app.json"), "w", encoding="utf-8") as f:
        json.dump(app, f, indent=1)
    shutil.copy(os.path.join(W, "app.ico"), out)
    if os.environ.get("STORE_URL", "").strip():
        with open(os.path.join(out, "defaults.json"), "w", encoding="utf-8") as f:
            json.dump({"url": os.environ["STORE_URL"].strip()}, f)

    if APP["kind"] == "node":
        srv = os.path.join(out, "server")
        os.makedirs(srv, exist_ok=True)
        for f in ("server.js", "dukaan.js", "package.json"):
            shutil.copy(os.path.join(ROOT, f), srv)
        shutil.copytree(os.path.join(ROOT, "public"), os.path.join(srv, "public"))
        node = shutil.which("node")
        if not node:
            sys.exit("Node.js is needed to build StoreKart")
        os.makedirs(os.path.join(out, "runtime"), exist_ok=True)
        shutil.copy(node, os.path.join(out, "runtime", APP["runtimeExe"]))

    with open(os.path.join(out, "LICENSE.txt"), "w", encoding="utf-8") as f:
        f.write(open(os.path.join(ROOT, "LICENSE"), encoding="utf-8").read() if os.path.exists(os.path.join(ROOT, "LICENSE"))
                else "MIT License\n")
    print("VERSION=" + version(), flush=True)


if __name__ == "__main__":
    main()
