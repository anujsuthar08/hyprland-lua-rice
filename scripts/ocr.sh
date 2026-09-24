#!/usr/bin/env bash
# Read the text in a region of the screen.
#
#   ocr.sh [copy] [FILE]       select a region, copy the text it contains
#   ocr.sh translate [FILE]    the same, then translate it (local model) and copy the translation
#   ocr.sh target [LANGUAGE]   show / set the language "translate" produces (default English)
#
# With FILE the image comes from the file instead of the screen (used for testing).
# OCR: tesseract with every language installed (pacman -S tesseract-data-hin ... adds more;
# `tesseract --list-langs`). Translation: your local Ollama model (the fast one, as in the Ask
# tab), so the text never leaves the machine. It prefers a translation model when one is installed
# (`ollama pull translategemma:4b`, 55 languages incl. Hindi and Gujarati), else any general model,
# else the smallest; force one with TRANSLATE_MODEL. Needs: grim slurp tesseract wl-clipboard libnotify
# imagemagick, and ollama for `translate`.
set -uo pipefail

STATE="${XDG_STATE_HOME:-$HOME/.local/state}/hypr-shell"
TARGET_FILE="$STATE/translate-to"
OLLAMA="${OLLAMA_HOST_URL:-http://127.0.0.1:11434}"

say() { notify-send -a "${APP:-OCR}" "$1" "${2:-}" >/dev/null 2>&1; }

mode=copy
case "${1:-}" in
  copy|translate) mode=$1; shift ;;
  target)
    if [ -n "${2:-}" ]; then mkdir -p "$STATE"; printf '%s\n' "$2" > "$TARGET_FILE"; fi
    echo "translate to: $(cat "$TARGET_FILE" 2>/dev/null || echo English)"; exit 0 ;;
esac
file="${1:-}"

for c in tesseract wl-copy magick; do
  command -v "$c" >/dev/null || { say "OCR unavailable" "$c is not installed (pacman -S tesseract tesseract-data-eng)"; exit 1; }
done

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
img="$tmp/region.png"
if [ -n "$file" ]; then
  cp "$file" "$img"
else
  for c in grim slurp; do command -v "$c" >/dev/null || { say "OCR unavailable" "$c is not installed"; exit 1; }; done
  region=$(slurp -b '#00000066' -c '#ffffffff' -w 2) || exit 0     # Escape = cancel, silently
  timeout 10 grim -g "$region" "$img" || { say "OCR failed" "could not capture the screen"; exit 1; }
fi

# every installed language except the orientation-only "osd" (tesseract combines them with +)
langs="${OCR_LANG:-$(tesseract --list-langs 2>/dev/null | sed 1d | grep -v '^osd$' | paste -sd+)}"
langs="${langs:-eng}"

# psm 6 = one uniform block; upscaling and greyscale help small UI text a lot
text=$(magick "$img" -resize 200% -colorspace Gray -normalize png:- 2>/dev/null \
  | tesseract stdin stdout -l "$langs" --psm 6 2>/dev/null | sed -e 's/[[:space:]]*$//' | cat -s)
text=${text#$'\n'}
if [ -z "${text//[[:space:]]/}" ]; then say "No text found" "Nothing readable in that region."; exit 0; fi

if [ "$mode" = copy ]; then
  printf '%s' "$text" | wl-copy
  say "Text copied" "$(printf '%s' "$text" | head -c 160)"
  exit 0
fi

# ── translate ─────────────────────────────────────────────────────────────
APP="Translate"
target=$(cat "$TARGET_FILE" 2>/dev/null); target=${target:-English}
say "Translating to $target..." "$(printf '%s' "$text" | head -c 100)"
export TEXT="$text" TARGET="$target" OLLAMA
result=$(python3 - <<'PY'
import json, os, urllib.request
base, text, target = os.environ["OLLAMA"], os.environ["TEXT"], os.environ["TARGET"]
CODES = {"english": "en", "hindi": "hi", "gujarati": "gu", "marathi": "mr", "bengali": "bn", "tamil": "ta", "telugu": "te",
         "kannada": "kn", "malayalam": "ml", "punjabi": "pa", "urdu": "ur", "spanish": "es", "french": "fr", "german": "de",
         "italian": "it", "portuguese": "pt", "russian": "ru", "japanese": "ja", "korean": "ko", "chinese": "zh",
         "arabic": "ar", "dutch": "nl", "turkish": "tr", "polish": "pl", "indonesian": "id", "vietnamese": "vi", "thai": "th"}
# models good at translation, best first; anything else falls back to the smallest installed model
PREFER = ("translategemma", "aya", "gemma3", "qwen2.5:", "llama3")
try:
    models = json.load(urllib.request.urlopen(base + "/api/tags", timeout=2))["models"]
    if not models: raise SystemExit("ERR:Ollama has no models (ollama pull translategemma:4b)")
    names = [m["name"] for m in models]
    model = os.environ.get("TRANSLATE_MODEL") or os.environ.get("ASK_MODEL")
    if not model:
        # a coder model is a poor translator: prefer a general/translation one when it is installed
        model = next((n for k in PREFER for n in sorted(names) if n.startswith(k) and "coder" not in n), None) \
                or min(models, key=lambda m: m.get("size", 0))["name"]
    code = CODES.get(target.strip().lower())
    tgt = "%s (%s)" % (target, code) if code else target
    if model.startswith("translategemma"):
        # the format the model was trained on: one user message, no system prompt, two blank lines before the text
        msgs = [{"role": "user", "content":
            "You are a professional translator. Detect the language of the text below and translate it into %s. "
            "Your goal is to accurately convey the meaning and nuances of the original text while adhering to %s "
            "grammar, vocabulary, and cultural sensitivities.\nProduce only the %s translation, without any "
            "additional explanations or commentary. Please translate the following text into %s:\n\n\n%s"
            % (tgt, target, target, target, text)}]
    else:
        msgs = [
            {"role": "system", "content": "You are a translation engine. Translate the user's text into %s. "
             "Output ONLY the translation: no quotes, no notes, no explanation. Keep the line breaks. "
             "The text came from OCR, so quietly fix obvious character-recognition slips. "
             "If it is already in %s, output it unchanged." % (target, target)},
            {"role": "user", "content": text}]
    body = {"model": model, "stream": False, "options": {"temperature": 0}, "keep_alive": "10m", "messages": msgs}
    req = urllib.request.Request(base + "/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    print(json.load(urllib.request.urlopen(req, timeout=180))["message"]["content"].strip())
except SystemExit as e:
    print(e)
except Exception as e:
    print("ERR:Ollama is not answering (%s). Start it with: systemctl start ollama" % type(e).__name__)
PY
)
case "$result" in
  ERR:*|"") say "Translation failed" "${result#ERR:}"; exit 1 ;;
esac
printf '%s' "$result" | wl-copy
say "Translated to $target (copied)" "$(printf '%s' "$result" | head -c 300)"
