"""Per-axis Gemini audio listen (diction, naturalness, style match scored separately), both orders, on
analysis/m2_pairs_to_judge.json. Hard USD stop.
Usage: python3 analysis/axes_pairs_run.py <m2-dir> <out.json> <hard_stop_usd>"""
import base64, json, os, sys, time, urllib.request, urllib.error

MODEL = "gemini-3.5-flash"
PRICE_IN, PRICE_OUT = 1.0, 5.0  # USD per million tokens; deliberately above list so the stop is conservative
AXES = ("diction", "naturalness", "style_match")
PROMPT = ("You are listening to two renditions (A then B) of the same Hindi song lyrics. For EACH of three axes pick the "
          "better one: diction = how clearly and correctly the Hindi words are sung (judge the words, not the tune); "
          "naturalness = how human and unmechanical the voice and phrasing sound; style_match = how well the "
          "arrangement fits the song's intended style. Reply with ONLY JSON: "
          "{\"diction\":\"A|B|tie\",\"naturalness\":\"A|B|tie\",\"style_match\":\"A|B|tie\"}")


def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()


def ask(key, first, second):
    body = {"contents": [{"role": "user", "parts": [
        {"text": PROMPT}, {"text": "A:"}, {"inline_data": {"mime_type": "audio/mpeg", "data": b64(first)}},
        {"text": "B:"}, {"inline_data": {"mime_type": "audio/mpeg", "data": b64(second)}}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 1500, "responseMimeType": "application/json"}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}"
    for t in range(4):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"}), timeout=180))
            u = r.get("usageMetadata", {})
            txt = "".join(p.get("text", "") for p in r["candidates"][0].get("content", {}).get("parts", []))
            if "{" not in txt:
                print("no JSON in reply, finish:", r["candidates"][0].get("finishReason"), "usage", u)
                time.sleep(3); continue
            return json.loads(txt[txt.index("{"):txt.rindex("}") + 1]), u
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503):
                time.sleep(4 * 2 ** t); continue
            raise
    raise RuntimeError("gemini failed")


def main(m2, out, stop):
    key = os.environ["GEMINI_API_KEY"]
    pairs = json.load(open(os.path.join(os.path.dirname(__file__), "m2_pairs_to_judge.json")))
    spent, res = 0.0, []
    for p in pairs:
        a, b = os.path.join(m2, p["a_file"]), os.path.join(m2, p["b_file"])
        got = {}
        for order, (x, y) in (("ab", (a, b)), ("ba", (b, a))):
            if spent >= stop:
                break
            j, u = ask(key, x, y)
            spent += (u.get("promptTokenCount", 0) * PRICE_IN + (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * PRICE_OUT) / 1e6
            got[order] = j
            time.sleep(2)
        pick = {}
        if len(got) == 2:
            for ax in AXES:
                w1 = {"A": "a", "B": "b"}.get(got["ab"].get(ax))
                w2 = {"A": "b", "B": "a"}.get(got["ba"].get(ax))
                pick[ax] = w1 if w1 == w2 and w1 else "split"
        res.append({**p, "orders": got, "pick": pick})
    json.dump({"spent_usd_est": round(spent, 4), "results": res}, open(out, "w"), ensure_ascii=False, indent=1)
    print("estimated spend USD", round(spent, 4))


main(sys.argv[1], sys.argv[2], float(sys.argv[3]))
