"""Windows app (launcher) for Dukaan and StoreKart.

The same file is used by both apps; app.json next to it says which app this is.

  * "Run on this computer": starts the app's server on this PC (data in %LOCALAPPDATA%\\<App>\\data),
    keeps it running with a taskbar (tray) icon, and phones on the same Wi-Fi can open it too.
  * "Open my server": opens an existing server (e.g. on Unraid or your domain) in the app window.

The app window is Microsoft Edge (or Chrome) in app mode with its own profile, so it looks like a
normal program and printing, camera and location work as in the browser.

Options:  --setup  change the setup     --kiosk  open the full-screen self-order screen (StoreKart)
          --background  start without opening a window (used by "Start with Windows")
          --selftest    start the server in a temporary folder, check it answers, and exit (for builds)
"""
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

FROZEN = getattr(sys, "frozen", False)
WIN = os.name == "nt"
SRC = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.dirname(sys.executable) if FROZEN else SRC


def _load_app():
    for folder in (HERE, getattr(sys, "_MEIPASS", HERE), SRC):
        p = os.path.join(folder, "app.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    raise SystemExit("app.json is missing")


APP = _load_app()
NAME = APP["name"]
TITLE = (APP.get("title") or "").strip() or NAME
HOME = os.environ.get("WINAPP_HOME") or os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share"), NAME)
CFG_FILE = os.path.join(HOME, "settings.json")
RUN_FILE = os.path.join(HOME, "running.json")
LOG_FILE = os.path.join(HOME, "app.log")
DATA_DIR = os.path.join(HOME, "data")
TEST = bool(os.environ.get("WINAPP_TEST"))  # no windows, no tray: used by tests
OPENED = []  # windows "opened" while testing


# ---------------------------------------------------------------- basics

def setup_log():
    os.makedirs(HOME, exist_ok=True)
    try:
        if os.path.getsize(LOG_FILE) > 2_000_000:
            os.replace(LOG_FILE, LOG_FILE + ".old")
    except OSError:
        pass
    if FROZEN or sys.stdout is None:
        f = open(LOG_FILE, "a", buffering=1, encoding="utf-8", errors="replace")
        sys.stdout = sys.stderr = f


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def message(text, error=False):
    """A Windows message box (in its own thread, so nothing waits for it)."""
    log("MESSAGE:", text)
    if not WIN or TEST:
        return

    def show():
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, TITLE, 0x10 if error else 0x40)
    threading.Thread(target=show, daemon=True).start()


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def http(url, data=None, timeout=6):
    req = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": NAME + "-Windows"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def healthy(base, timeout=4):
    try:
        st, body = http(base.rstrip("/") + APP["health"], timeout=timeout)
        return st == 200
    except Exception:
        return False


def norm_url(u):
    u = (u or "").strip().rstrip("/")
    if not u:
        return ""
    if "://" not in u:
        host = u.split("/")[0].split(":")[0]
        local = host == "localhost" or host.replace(".", "").isdigit() or host.endswith(".local")
        u = ("http://" if local else "https://") + u
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc:
        return ""
    return f"{p.scheme}://{p.netloc}{p.path.rstrip('/')}"


def lan_addresses(port):
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the main network card
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips = sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.")))
    return [f"http://{ip}:{port}" for ip in ips]


def load_cfg():
    c = read_json(CFG_FILE)
    return c if isinstance(c, dict) and c.get("mode") in ("local", "remote") else None


# ---------------------------------------------------------------- start with Windows

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def autostart_get():
    if not (WIN and FROZEN):
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, NAME)
            return True
    except OSError:
        return False


def autostart_set(on):
    if not (WIN and FROZEN):
        return
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, NAME, 0, winreg.REG_SZ, f'"{sys.executable}" --background')
        else:
            try:
                winreg.DeleteValue(k, NAME)
            except OSError:
                pass


# ---------------------------------------------------------------- the app window

def find_browser():
    names = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"]
    roots = [os.environ.get(v) for v in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    for n in names:
        for r in roots:
            if r and os.path.exists(os.path.join(r, n)):
                return os.path.join(r, n)
    if WIN:
        import winreg
        for exe in ("msedge.exe", "chrome.exe"):
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\App Paths\\" + exe) as k:
                        p = winreg.QueryValue(k, None)
                        if p and os.path.exists(p):
                            return p
                except OSError:
                    pass
    for exe in ("msedge", "microsoft-edge", "google-chrome", "chromium", "chrome"):
        p = shutil.which(exe)
        if p:
            return p
    return None


def open_window(url, kiosk=False):
    log("open window:", url, "(kiosk)" if kiosk else "")
    if TEST:
        OPENED.append((url, kiosk))
        return
    exe = find_browser()
    if not exe:
        webbrowser.open(url)
        return
    profile = os.path.join(HOME, "kiosk-window" if kiosk else "window")
    args = [exe, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check"]
    if kiosk:
        args += ["--kiosk", url]
        if "msedge" in exe.lower():
            args.append("--edge-kiosk-type=fullscreen")
    else:
        args.append("--app=" + url)
    flags = 0x00000008 if WIN else 0  # DETACHED_PROCESS
    subprocess.Popen(args, close_fds=True, creationflags=flags)


# ---------------------------------------------------------------- the app's own server on this PC

class LocalServer:
    def __init__(self, port, data_dir=DATA_DIR):
        self.port = int(port)
        self.data_dir = data_dir
        self.srv = None
        self.proc = None
        self.adopted = False

    @property
    def base(self):
        return f"http://localhost:{self.port}"

    def needs_password(self):
        return APP["kind"] == "python" and not os.path.exists(os.path.join(self.data_dir, APP.get("dbFile", "")))

    def start(self, owner_password=None):
        os.makedirs(self.data_dir, exist_ok=True)
        if healthy(f"http://127.0.0.1:{self.port}", timeout=2):
            log("server already answering on port", self.port, "- using it")
            self.adopted = True
            return
        if port_busy(self.port):
            raise RuntimeError(f"Port {self.port} is used by another program on this computer. "
                               f"Pick another port in {NAME}'s setup.")
        if APP["kind"] == "python":
            self._start_python(owner_password)
        else:
            self._start_node()
        t = time.time()
        while time.time() - t < 45:
            if healthy(f"http://127.0.0.1:{self.port}", timeout=2):
                log("server running on port", self.port)
                return
            if self.proc is not None and self.proc.poll() is not None:
                break
            time.sleep(0.4)
        self.stop()
        raise RuntimeError(f"{NAME} couldn't start. Details are in {LOG_FILE}")

    def _start_python(self, owner_password):
        os.environ["DATA_DIR"] = self.data_dir
        os.environ["PORT"] = str(self.port)
        if owner_password:
            os.environ["APP_PASSWORD"] = owner_password
        if not FROZEN:
            sys.path.insert(0, os.path.normpath(os.path.join(SRC, APP.get("source", "."))))
        import main as app_main  # the app itself (bundled into the .exe)
        import db as app_db
        if os.path.normcase(os.path.abspath(app_db.DATA_DIR)) != os.path.normcase(os.path.abspath(self.data_dir)):
            raise RuntimeError("The data folder can't change while the app is running. Quit and open it again.")
        self.srv = app_main.serve(self.port)
        if owner_password and not app_db.get("owner_pw"):
            import auth as app_auth
            app_db.put("owner_pw", app_auth._hash(owner_password))
        os.environ.pop("APP_PASSWORD", None)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def _start_node(self):
        if FROZEN:
            node = os.path.join(HERE, "runtime", APP.get("runtimeExe", "node.exe"))
            script = os.path.join(HERE, "server", APP.get("script", "server.js"))
        else:
            node = shutil.which("node") or "node"
            script = os.path.normpath(os.path.join(SRC, APP.get("source", "."), APP.get("script", "server.js")))
        env = dict(os.environ, PORT=str(self.port), DATA_DIR=self.data_dir)
        out = open(LOG_FILE, "a", encoding="utf-8", errors="replace")
        self.proc = subprocess.Popen([node, script], env=env, cwd=os.path.dirname(script), stdout=out,
                                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                     creationflags=0x08000000 if WIN else 0)  # CREATE_NO_WINDOW

    def stop(self):
        if self.srv:
            try:
                self.srv.shutdown()
                self.srv.server_close()
            except Exception:
                pass
            self.srv = None
        if self.proc:
            try:
                self.proc.terminate()
                self.proc.wait(8)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
            self.proc = None


def port_busy(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", int(port))) == 0
    finally:
        s.close()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ---------------------------------------------------------------- the running app (control page + tray)

class State:
    def __init__(self, cfg, defaults):
        self.cfg = cfg
        self.defaults = defaults
        self.server = None
        self.error = ""
        self.token = secrets.token_urlsafe(16)
        self.ctrl = None
        self.icon = None
        self.quit_event = threading.Event()
        self.lock = threading.Lock()

    @property
    def ctrl_base(self):
        return f"http://127.0.0.1:{self.ctrl.server_address[1]}/{self.token}"

    def target(self, what="home"):
        """The address the window should open."""
        if what == "setup" or not self.cfg or (self.cfg["mode"] == "local" and not self.server):
            return self.ctrl_base + "/setup", False
        if what == "lan":
            return self.ctrl_base + "/lan", False
        base = self.cfg["url"] if self.cfg["mode"] == "remote" else self.server.base
        if what == "kiosk" and APP.get("kiosk"):
            return base + APP["kiosk"], True
        return base + APP.get("open", "/"), False

    def open(self, what="home"):
        url, kiosk = self.target(what)
        open_window(url, kiosk)

    def start_local(self, owner_password=None):
        port = int(self.cfg.get("port") or APP["port"])
        if self.server and self.server.port == port:
            return
        if self.server:
            self.server.stop()
            self.server = None
        s = LocalServer(port)
        s.start(owner_password)
        self.server = s
        self.error = ""

    def state_json(self):
        cfg = self.cfg or {}
        port = int(cfg.get("port") or APP["port"])
        return {
            "app": NAME, "title": TITLE, "kind": APP["kind"], "configured": bool(self.cfg),
            "mode": cfg.get("mode") or ("remote" if self.defaults.get("url") else "local"),
            "url": cfg.get("url") or self.defaults.get("url", ""), "port": port,
            "autostart": autostart_get() if self.cfg else True,
            "needPassword": APP["kind"] == "python" and LocalServer(port).needs_password(),
            "running": bool(self.server), "error": self.error, "dataDir": DATA_DIR,
            "lan": lan_addresses(self.server.port) if self.server else [],
            "texts": APP.get("texts", {}), "kiosk": bool(APP.get("kiosk")),
        }

    def apply(self, d):
        """Save the setup from the setup page. Returns {"go": url} or {"error": text}."""
        with self.lock:
            mode = d.get("mode")
            if mode == "remote":
                url = norm_url(d.get("url"))
                if not url:
                    return {"error": "Type your server's address, for example " + APP["texts"].get("example", "https://shop.example.com")}
                if not d.get("force") and not healthy(url, timeout=8):
                    return {"error": f"{NAME} didn't answer at {url}. Check the address and that the server is on.",
                            "canForce": True}
                if self.server:
                    self.server.stop()
                    self.server = None
                self.cfg = {"mode": "remote", "url": url}
                write_json(CFG_FILE, self.cfg)
                autostart_set(False)
                threading.Timer(1.5, self.quit).start()  # the window carries on by itself
                return {"go": url + APP.get("open", "/")}
            if mode == "local":
                try:
                    port = int(d.get("port") or APP["port"])
                    assert 1024 <= port <= 65535
                except (ValueError, AssertionError):
                    return {"error": "The port must be a number from 1024 to 65535."}
                pw = d.get("password") or ""
                if APP["kind"] == "python" and LocalServer(port).needs_password() and len(pw) < 6:
                    return {"error": "Choose the owner's password (at least 6 characters)."}
                old = self.cfg
                self.cfg = {"mode": "local", "port": port}
                try:
                    self.start_local(pw or None)
                except Exception as e:
                    log(traceback.format_exc())
                    self.cfg = old
                    return {"error": str(e)}
                write_json(CFG_FILE, self.cfg)
                autostart_set(bool(d.get("autostart", True)))
                first = not old
                if first and self.icon:
                    lan = lan_addresses(port)
                    try:
                        self.icon.notify(f"{NAME} keeps running here, in the taskbar corner."
                                         + (f" Phones on this Wi-Fi: {lan[0]}" if lan else ""), TITLE)
                    except Exception:
                        pass
                return {"go": self.server.base + APP.get("open", "/")}
            return {"error": "Choose how to use " + NAME + "."}

    def quit(self):
        log("quit")
        if self.server:
            self.server.stop()
        try:
            if read_json(RUN_FILE, {}).get("pid") == os.getpid():
                os.remove(RUN_FILE)
        except OSError:
            pass
        self.quit_event.set()
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass


def control_server(state):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            if not isinstance(body, bytes):
                body = (json.dumps(body) if ctype == "application/json" else body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _path(self):
            p = urlparse(self.path).path
            pre = "/" + state.token
            if not p.startswith(pre + "/"):
                return None
            return p[len(pre):]

        def do_GET(self):
            p = self._path()
            if p is None:
                return self._send(404, {"error": "not found"})
            if p == "/ping":
                return self._send(200, {"app": NAME, "pid": os.getpid()})
            if p in ("/setup", "/lan"):
                return self._send(200, PAGE.replace("__PAGE__", p[1:]).replace("__TITLE__", TITLE), "text/html")
            if p == "/api/state":
                return self._send(200, state.state_json())
            if p == "/api/qr":
                return self._send(200, qr_svg(self.headers.get("X-Text", "")), "image/svg+xml")
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            p = self._path()
            if p is None:
                return self._send(404, {"error": "not found"})
            n = int(self.headers.get("Content-Length") or 0)
            try:
                d = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                d = {}
            if p == "/open":
                state.open(d.get("what") or "home")
                return self._send(200, {"ok": True})
            if p == "/api/setup":
                return self._send(200, state.apply(d))
            if p == "/api/autostart":
                autostart_set(bool(d.get("on")))
                return self._send(200, {"ok": True})
            if p == "/api/folder":
                if WIN:
                    os.startfile(DATA_DIR)
                return self._send(200, {"ok": True})
            if p == "/api/quit":
                threading.Timer(0.5, state.quit).start()
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def qr_svg(text):
    try:
        import io
        import segno
        out = io.BytesIO()
        segno.make(text, error="m").save(out, kind="svg", scale=6, border=2, xmldecl=False)
        return out.getvalue()
    except Exception:
        return b""


def run_tray(state):
    if TEST:
        state.quit_event.wait()
        return
    try:
        import pystray
        from PIL import Image
    except Exception:
        log("no tray icon available:", traceback.format_exc())
        state.quit_event.wait()
        return
    ico = next((p for p in (os.path.join(HERE, "app.ico"), os.path.join(getattr(sys, "_MEIPASS", HERE), "app.ico"),
                            os.path.join(SRC, "app.ico")) if os.path.exists(p)), None)
    img = Image.open(ico) if ico else Image.new("RGB", (64, 64), "#1f7a4d")
    local = lambda item: bool(state.cfg and state.cfg["mode"] == "local")  # noqa: E731
    running = lambda item: bool(state.server)  # noqa: E731

    def toggle_autostart(icon, item):
        autostart_set(not autostart_get())

    def folder(icon, item):
        os.startfile(DATA_DIR)

    M = pystray.MenuItem
    menu = pystray.Menu(
        M(f"Open {TITLE}", lambda icon, item: state.open("home"), default=True),
        M("Self-order screen (full screen)", lambda icon, item: state.open("kiosk"),
          visible=lambda item: bool(APP.get("kiosk") and (state.server or (state.cfg and state.cfg["mode"] == "remote")))),
        M("Phones and other computers…", lambda icon, item: state.open("lan"), visible=running),
        M("Change setup…", lambda icon, item: state.open("setup")),
        M("Open data folder", folder, visible=local),
        M("Start with Windows", toggle_autostart, checked=lambda item: autostart_get(), visible=local),
        pystray.Menu.SEPARATOR,
        M("Quit " + NAME, lambda icon, item: state.quit()),
    )
    state.icon = pystray.Icon(NAME, img, TITLE, menu)
    state.icon.run()


# ---------------------------------------------------------------- start

def other_instance():
    r = read_json(RUN_FILE)
    if not r:
        return None
    base = f"http://127.0.0.1:{r.get('port')}/{r.get('token')}"
    try:
        st, body = http(base + "/ping", timeout=2)
        if st == 200 and json.loads(body).get("app") == NAME:
            return base
    except Exception:
        pass
    return None


def run(args):
    what = "setup" if "--setup" in args else "kiosk" if "--kiosk" in args else "home"
    background = "--background" in args
    defaults = read_json(os.path.join(HERE, "defaults.json"), {}) or {}
    if defaults.get("url"):
        defaults["url"] = norm_url(defaults["url"])

    other = other_instance()
    if other:
        if not background:
            http(other + "/open", {"what": what})
        return 0

    cfg = load_cfg()
    if cfg and cfg["mode"] == "remote" and what != "setup":
        if not background:
            open_window(cfg["url"] + (APP["kiosk"] if what == "kiosk" and APP.get("kiosk") else APP.get("open", "/")),
                        kiosk=what == "kiosk" and bool(APP.get("kiosk")))
        return 0
    if background and not cfg:
        return 0

    state = State(cfg, defaults)
    state.ctrl = control_server(state)
    write_json(RUN_FILE, {"pid": os.getpid(), "port": state.ctrl.server_address[1], "token": state.token})
    if cfg and cfg["mode"] == "local":
        try:
            state.start_local()
        except Exception as e:
            log(traceback.format_exc())
            state.error = str(e)
            what = "setup"
            if background:
                message(f"{NAME} couldn't start: {e}", error=True)
    if not background or state.error:
        state.open(what)
    run_tray(state)
    return 0


def selftest():
    """Used by the build: start the server in a temporary folder and check it answers."""
    global DATA_DIR
    tmp = tempfile.mkdtemp(prefix=NAME + "-selftest-")
    DATA_DIR = os.path.join(tmp, "data")
    port = free_port()
    s = LocalServer(port, DATA_DIR)
    ok = False
    try:
        s.start("selftest-123")
        ok = healthy(f"http://127.0.0.1:{port}")
        st, page = http(f"http://127.0.0.1:{port}/", timeout=10)
        ok = ok and st == 200 and b"<" in page[:200]  # the app's own page loads too
        log("selftest", NAME, "port", port, "OK" if ok else "FAILED")
    except Exception:
        log(traceback.format_exc())
    finally:
        s.stop()
    return 0 if ok else 1


def main():
    setup_log()
    args = sys.argv[1:]
    log(NAME, "Windows app starting", " ".join(args))
    try:
        return selftest() if "--selftest" in args else run(args)
    except Exception as e:
        log(traceback.format_exc())
        message(f"{NAME} stopped because of a problem: {e}\n\nDetails: {LOG_FILE}", error=True)
        return 1


PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 "Segoe UI",system-ui,sans-serif;background:#f3f5f4;color:#1b1d21}
.wrap{max-width:620px;margin:0 auto;padding:28px 20px 40px}h1{font-size:24px;margin:0 0 4px}.muted{color:#5d636b}.small{font-size:13px}
.card{background:#fff;border:1px solid #dfe3e1;border-radius:12px;padding:16px 18px;margin:14px 0}
.opt{display:flex;gap:12px;align-items:flex-start;cursor:pointer;border:2px solid #dfe3e1;border-radius:12px;padding:14px 16px;margin:10px 0;background:#fff}
.opt.on{border-color:#1f7a4d;background:#f1faf5}.opt input{margin-top:4px;accent-color:#1f7a4d}.opt b{font-size:16px}
label.f{display:block;margin:12px 0 4px;font-weight:600}input[type=text],input[type=password],input[type=number]{width:100%;padding:10px 12px;border:1px solid #c9cfcc;border-radius:8px;font:inherit}
.btn{display:inline-block;border:0;border-radius:8px;padding:11px 20px;font:inherit;font-weight:600;cursor:pointer;background:#e7ebe9;color:#1b1d21}
.btn.p{background:#1f7a4d;color:#fff}.btn:disabled{opacity:.6}.err{background:#fdecea;color:#8a1c12;border-radius:8px;padding:10px 12px;margin:12px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.addr{font-size:22px;font-weight:700;word-break:break-all}.qr svg{width:180px;height:180px}
.chk{display:flex;gap:8px;align-items:center;margin-top:12px}</style></head><body><div class="wrap" id="root">Loading…</div>
<script>
const PAGE="__PAGE__", base=location.pathname.replace(/\/[a-z]+$/,'');
let S=null, mode=null, busy=false, err='', canForce=false;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p,d){const r=await fetch(base+p,d===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});return r.json()}
async function load(){S=await api('/api/state');mode=mode||S.mode;err=err||S.error||'';PAGE==='lan'?lan():setup()}
function setup(){const T=S.texts||{};document.title=S.title+' – setup';
root.innerHTML=`<h1>${esc(S.title)} on this computer</h1><div class="muted">${S.configured?'Change how this computer uses '+esc(S.app)+'.':'How will you use '+esc(S.app)+' on this computer?'}</div>
<label class="opt ${mode==='local'?'on':''}"><input type="radio" name="m" value="local" ${mode==='local'?'checked':''}><div><b>Run ${esc(S.app)} on this computer</b><div class="small muted">${esc(T.local||'')}</div></div></label>
<label class="opt ${mode==='remote'?'on':''}"><input type="radio" name="m" value="remote" ${mode==='remote'?'checked':''}><div><b>Open my ${esc(S.app)} server</b><div class="small muted">${esc(T.remote||'')}</div></div></label>
<div class="card">${mode==='remote'?`<label class="f" for="url">Server address</label><input type="text" id="url" value="${esc(S.url)}" placeholder="${esc(T.example||'')}"><div class="small muted" style="margin-top:6px">${esc(T.remoteHint||'')}</div>`:
`${S.needPassword?`<label class="f" for="pw">Owner's password</label><input type="password" id="pw" autocomplete="new-password" placeholder="At least 6 characters"><div class="small muted" style="margin-top:6px">You log in to ${esc(S.app)} with this. You can change it later in Settings.</div>`:''}
<label class="chk"><input type="checkbox" id="auto" ${S.autostart?'checked':''}> Start ${esc(S.app)} when Windows starts (so phones and other computers can always reach it)</label>
<details style="margin-top:12px"><summary class="small muted">Advanced</summary><label class="f" for="port">Port</label><input type="number" id="port" value="${S.port}" min="1024" max="65535" style="max-width:160px"><div class="small muted">Data is saved in ${esc(S.dataDir)}</div></details>`}
${err?`<div class="err">${esc(err)}</div>`:''}
<div class="row" style="margin-top:14px"><button class="btn p" id="go" ${busy?'disabled':''}>${busy?'Starting…':(canForce?'Use this address anyway':'Start')}</button>${S.configured&&S.running?'<button class="btn" id="lanb">Phones and other computers</button>':''}</div></div>
${S.kiosk?`<div class="small muted">Tip: the Start menu has “${esc(S.app)} self-order screen”, which opens the customer self-order screen full screen (Alt+F4 closes it).</div>`:''}`;
root.querySelectorAll('input[name=m]').forEach(r=>r.onchange=()=>{mode=r.value;err='';canForce=false;setup()});
go.onclick=submit; const lb=document.getElementById('lanb'); if(lb) lb.onclick=()=>location.href=base+'/lan';
const u=document.getElementById('url'); if(u) u.oninput=()=>{canForce=false;go.textContent='Start'}}
async function submit(){busy=true;err='';const d={mode,force:canForce};
if(mode==='remote')d.url=url.value;else{d.port=+port.value;d.autostart=auto.checked;const p=document.getElementById('pw');if(p)d.password=p.value}
setup();let r;try{r=await api('/api/setup',d)}catch(e){r={error:'Something went wrong: '+e}}
busy=false;if(r.go){location.href=r.go;return}err=r.error||'';canForce=!!r.canForce;setup()}
async function lan(){document.title=S.title+' – phones and other computers';
if(!S.running){root.innerHTML=`<h1>${esc(S.title)}</h1><p>${esc(S.app)} isn't running on this computer.</p>`;return}
const a=S.lan;root.innerHTML=`<h1>Phones and other computers</h1><div class="muted">Connect the phone or computer to the <b>same Wi-Fi</b> as this computer, then open:</div>
${a.length?a.map(x=>`<div class="card row"><div class="qr" data-t="${esc(x)}"></div><div><div class="addr">${esc(x)}</div><div class="small muted">Type it in Chrome, or scan the code with the phone's camera.</div></div></div>`).join(''):'<div class="err">This computer isn\'t connected to a network.</div>'}
<div class="card small">If it doesn't open: when Windows asked about the firewall, “Allow” must have been chosen. The installer allows it for you.<br>To reach ${esc(S.app)} from outside the shop (for example customers ordering from home), use a Cloudflare Tunnel to this computer, or run ${esc(S.app)} on your server instead.</div>
<button class="btn" onclick="location.href=base+'/setup'">Back</button>`;
for(const el of root.querySelectorAll('.qr')){try{const r=await fetch(base+'/api/qr',{headers:{'X-Text':el.dataset.t}});const t=await r.text();if(t.startsWith('<'))el.innerHTML=t;else if(window.QR)el.innerHTML=QR.svg(el.dataset.t);}catch(e){}}}
load();
</script>__QRLIB__</body></html>"""
PAGE = PAGE.replace("__QRLIB__", "")


if __name__ == "__main__":
    sys.exit(main())
