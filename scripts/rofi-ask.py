#!/usr/bin/env python3
"""Ask a local AI model.  `rofi -show ask`, or the "Ask" tab.  Everything stays on this
machine: it talks to Ollama on localhost:11434 and stores chats in ~/.local/state/hypr-shell/ask.

  type a question, Enter    ask the FAST model (the smallest installed one)
  !question                 ask the BIG model (largest installed under ~12 GB): better, slower
  type again in a chat      a follow-up; the model sees the whole conversation
  Copy answer               copy the whole answer to the clipboard
  New chat / a past chat    start over / go back to an older conversation
  Ctrl+Enter                send exactly what you typed even if it matches a row

Answers stream in the background: rofi cannot update a list while a script runs, so a worker
process writes the reply to a file as it arrives. If it is not finished within a few seconds
the tab shows what has arrived so far and a "Refresh" row (a slow model on a CPU can take
tens of seconds); the worker keeps going even if you close the tab.

Pick models with ASK_MODEL / ASK_MODEL_BIG (environment), otherwise they are chosen from what
`ollama list` shows. rofi script protocol: ROFI_RETV 0 first call, 1 a row chosen, 2 custom
text, 3 delete; ROFI_DATA carries "which chat is open" between calls.
"""
import html, json, os, subprocess, sys, time, urllib.request, uuid

OLLAMA = os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")
DIR = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell", "ask")
SYSTEM = ("You are a concise assistant inside a desktop launcher. Reply in plain text with no markdown "
          "(no asterisks, no headings, no bullet symbols). Answer directly in 1-4 short sentences unless "
          "the user asks for code or steps; keep code short and on its own lines.")
WAIT_S = 6.0          # how long to wait for the answer before showing a partial one
SHOW_CHARS = 1400     # the message area shows this much; "Copy answer" gets everything
KEEP_ALIVE = {"fast": "10m", "big": "2m"}   # the big model holds ~10 GB of RAM: release it sooner


# ── storage ─────────────────────────────────────────────────────────────
def path(*p): return os.path.join(DIR, *p)


def load(tid):
    try:
        with open(path("thread-%s.json" % tid), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save(t):
    os.makedirs(DIR, exist_ok=True)
    tmp = path("thread-%s.json.tmp" % t["id"])
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(t, f, ensure_ascii=False)
    os.replace(tmp, path("thread-%s.json" % t["id"]))  # atomic: the worker and rofi both read it


def partial(tid):
    try:
        with open(path("thread-%s.partial" % tid), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def threads():
    out = []
    try:
        for n in os.listdir(DIR):
            if n.startswith("thread-") and n.endswith(".json"):
                t = load(n[7:-5])
                if t: out.append(t)
    except OSError:
        pass
    return sorted(out, key=lambda t: t.get("ts", 0), reverse=True)


# ── ollama ───────────────────────────────────────────────────────────────
def installed():
    """[(name, bytes)] from `ollama list` (the API's /api/tags), or None if ollama is not answering."""
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=2) as r:
            return [(m["name"], m.get("size", 0)) for m in json.load(r)["models"]]
    except Exception:
        return None


# models that only translate (they answer a question with a translation of it): never pick these to chat with
NOT_CHAT = ("translategemma", "embed", "nomic", "bge", "minilm")


def pick_models(models):
    models = [m for m in models if not any(k in m[0].lower() for k in NOT_CHAT)] or models
    fast = os.environ.get("ASK_MODEL")
    big = os.environ.get("ASK_MODEL_BIG")
    by_size = sorted(models, key=lambda m: m[1])
    if not fast and by_size: fast = by_size[0][0]
    if not big:
        ok = [m for m in by_size if m[1] <= 12 * 1024 ** 3]   # a 32B model is minutes per answer on a CPU
        big = ok[-1][0] if ok else fast
    return fast, big


def worker(tid):
    t = load(tid)
    if not t: return
    pfile = path("thread-%s.partial" % tid)
    text = ""
    try:
        body = {"model": t["model"], "stream": True, "keep_alive": KEEP_ALIVE["big" if t.get("big") else "fast"],
                "messages": [{"role": "system", "content": SYSTEM}] + t["messages"]}
        req = urllib.request.Request(OLLAMA + "/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            for line in r:
                d = json.loads(line)
                text += d.get("message", {}).get("content", "")
                with open(pfile, "w", encoding="utf-8") as f: f.write(text)
                if d.get("done"): break
        t = load(tid) or t
        t["messages"].append({"role": "assistant", "content": text.strip() or "(no answer)"})
        t["error"] = None
    except Exception as e:
        t = load(tid) or t
        t["error"] = "%s: %s" % (type(e).__name__, e)
    t["pending"] = False
    save(t)
    try: os.remove(pfile)
    except OSError: pass


def send(text, tid, models):
    fast, big = pick_models(models)
    use_big = text.startswith("!")
    q = text.lstrip("!").strip()
    if not q: return None
    t = load(tid) if tid else None
    if not t or t.get("pending"):
        t = {"id": uuid.uuid4().hex[:10], "title": q[:60], "messages": []}
    t.update(model=big if use_big else fast, big=use_big, ts=time.time(), pending=True, error=None)
    t["messages"].append({"role": "user", "content": q})
    save(t)
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "--worker", t["id"]], stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return t["id"]


# ── rofi output ────────────────────────────────────────────────────────────
def esc(s): return html.escape(s, quote=False)


def out(prompt, message, rows, data=""):
    """rofi's script protocol is LINE based: a message (or row) can never contain a newline, or
    the rest becomes rows. Multi-line text is therefore a run of rows, and rows given as
    (label, None) are display-only (nonselectable), so typing a follow-up never selects them."""
    s = "\0prompt\x1f%s\n\0markup-rows\x1ftrue\n\0message\x1f%s\n\0data\x1f%s\n" % (prompt, message.replace("\n", " "), data)
    for label, info in rows:
        label = label.replace("\n", " ")
        s += ("%s\0info\x1f%s\n" % (label, info)) if info is not None else ("%s\0nonselectable\x1ftrue\n" % label)
    sys.stdout.write(s)


import textwrap


def wrap_rows(text, width=92, style="%s"):
    """text -> display-only rows, keeping the model's own line breaks (code, steps)."""
    rows = []
    for para in text.split("\n"):
        for line in (textwrap.wrap(para, width, replace_whitespace=False, drop_whitespace=True) or [""]):
            rows.append((style % esc(line) if line else " ", None))
    return rows


def recent_rows(skip=None):
    return [("%s   <span alpha='55%%'>%s</span>" % (esc(t["title"]), esc(t.get("model", ""))), "thread:" + t["id"])
            for t in threads()[:8] if t["id"] != skip]


KEEP_THREADS = 30


def prune():
    """Chats are plain files; keep the newest few so the folder does not grow forever."""
    for t in threads()[KEEP_THREADS:]:
        for ext in ("json", "partial"):
            try: os.remove(path("thread-%s.%s" % (t["id"], ext)))
            except OSError: pass


def home(models, note=""):
    prune()
    fast, big = pick_models(models)
    msg = (note + "\n" if note else "") + "Ask anything. Local model <b>%s</b> answers; start with <b>!</b> for <b>%s</b> (slower)." % (esc(fast), esc(big))
    rows = recent_rows()
    if not rows: rows = [(" ", "none")]      # rofi quits on an empty list
    out("Ask", msg, rows)


def view(tid, models, wait=0.0):
    deadline = time.time() + wait
    t = load(tid)
    while t and t.get("pending") and time.time() < deadline:
        time.sleep(0.2)
        t = load(tid)
    if not t: return home(models)
    q = next((m["content"] for m in reversed(t["messages"]) if m["role"] == "user"), "")
    ans = ""
    if t.get("pending"): ans = partial(tid)
    else:
        last = t["messages"][-1] if t["messages"] else None
        if last and last["role"] == "assistant": ans = last["content"]
    shown = ans if len(ans) <= SHOW_CHARS else ans[:SHOW_CHARS].rstrip() + " ..."
    status = "%s  ·  %s" % (t.get("model", ""), "thinking...  press Refresh" if t.get("pending")
                            else "type to follow up  ·  Ctrl+Enter sends exactly what you typed")
    # actions FIRST: rofi highlights the first row and this build ignores `new-selection`, so the
    # default action (Enter) is Copy answer, or Refresh while the answer is still arriving
    rows = []
    if t.get("pending"): rows.append(("Refresh", "refresh"))
    elif ans: rows.append(("Copy answer", "copy"))
    rows.append(("New chat", "new"))
    rows += wrap_rows(q, style="<b>%s</b>")
    if t.get("error"): rows += wrap_rows(t["error"], style="<span foreground='#ffb4ab'>%s</span>")
    elif shown: rows += wrap_rows(shown + (" ▍" if t.get("pending") else ""))
    rows += recent_rows(skip=tid)
    out("Ask", status, rows, data=tid)


def notify(title, body=""):
    subprocess.run(["notify-send", "-a", "Ask", title, body], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def rofi_main():
    retv = int(os.environ.get("ROFI_RETV", "0"))
    info = os.environ.get("ROFI_INFO", "")
    tid = os.environ.get("ROFI_DATA", "") or None
    models = installed()
    if models is None:
        return out("Ask", "Ollama is not answering on localhost:11434. Start it with <b>systemctl start ollama</b>.", [(" ", "none")])
    if not models:
        return out("Ask", "Ollama has no models. Install one, e.g. <b>ollama pull qwen2.5-coder:3b</b>.", [(" ", "none")])
    if retv == 0: return home(models)
    if retv == 2:
        new = send(sys.argv[1] if len(sys.argv) > 1 else "", tid, models)
        return view(new, models, wait=WAIT_S) if new else (view(tid, models) if tid else home(models))
    if retv == 1:
        if info == "new" or info == "none": return home(models)
        if info == "refresh": return view(tid, models, wait=4.0)
        if info.startswith("thread:"): return view(info[7:], models)
        if info == "copy" and tid:
            t = load(tid)
            a = t["messages"][-1]["content"] if t and t["messages"] else ""
            if a:
                subprocess.run(["wl-copy"], input=a.encode())
                notify("Answer copied", a[:120])
            return


if __name__ == "__main__":
    if sys.argv[1:2] == ["--worker"]: worker(sys.argv[2])
    elif "ROFI_RETV" in os.environ: rofi_main()
    else:
        print(__doc__)
