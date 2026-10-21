"""Debiased Gemini audio judge protocol (stdlib only). Three probes, each built to defeat the slot bias seen in
FINDINGS-holistic-judge.md and the E9-en pairs. Nothing runs without --hard-stop-usd; no spend on import.

  genre   blind: the judge names genre/instruments/vocal from ONE clip with no brief, from a closed list. Checked against the
          known label, so it tests whether the judge hears the audio at all (the E9-en reasons named genres the clips were not).
  point   one clip, absolute 1-5 on fixed anchors (below), k samples at temperature 0.7, median. No second clip, so no slot.
  pair    two clips, k repeats with randomised slot order; a pick counts only if it wins in the clear majority of both slots.

Usage: python3 debiased_audio_judge.py <mode> <spec.json> <out.json> --hard-stop-usd 0.6 [--k 3]
spec.json: genre/point -> [{"id","file","label"?}], pair -> [{"id","a_file","b_file"}]. Files are mp3 paths."""
import base64, json, os, random, statistics, sys, time, urllib.error, urllib.request

MODEL = "gemini-3.5-flash"
PRICE_IN, PRICE_OUT = 1.0, 5.0  # USD per million tokens, above list so the stop is conservative
GENRES = ["pop", "rock", "hip-hop", "country", "r&b", "indie folk", "dance", "film song", "devotional", "folk", "classical", "other"]
ANCHORS = ("Score each field 1-5 against these anchors. Singing: 1 = unintelligible or robotic, 3 = understandable with audible slips, "
           "5 = natural, in tune, every word clear. Production: 1 = noisy or broken, 3 = clean but generic, 5 = polished and well balanced. "
           "Use the full range; 3 is the middle, not the default.")
P_GENRE = ("Listen to this song. Do not guess what it should be: say what you hear. Reply ONLY JSON: {\"genre\":\"one of "
           + "|".join(GENRES) + "\",\"instruments\":[\"up to 4\"],\"vocal\":\"male|female|mixed|rap|none\",\"tempo\":\"slow|mid|fast\"}")
P_POINT = ANCHORS + " Reply ONLY JSON: {\"singing\":1-5,\"production\":1-5,\"words_clear\":true|false,\"evidence\":\"<=20 words quoting what you heard\"}"
P_PAIR = ("Two songs, A then B, for the same lyrics. Judge only the singing and production, not the genre. If they are equally good say tie. "
          "Reply ONLY JSON: {\"winner\":\"A\"|\"B\"|\"tie\",\"reason\":\"<=20 words\"}")


def part(p):
    return {"inline_data": {"mime_type": "audio/mpeg", "data": base64.b64encode(open(p, "rb").read()).decode()}}


def ask(key, parts, temp):
    body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"temperature": temp, "maxOutputTokens": 2500, "responseMimeType": "application/json"}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}"
    for t in range(4):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"}), timeout=180))
            u = r.get("usageMetadata", {})
            txt = "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
            cost = (u.get("promptTokenCount", 0) * PRICE_IN + (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * PRICE_OUT) / 1e6
            return (json.loads(txt[txt.index("{"):txt.rindex("}") + 1]) if "{" in txt else None), cost
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503):
                time.sleep(4 * 2 ** t); continue
            raise
    return None, 0.0


def main(mode, spec, out, stop, k):
    key, items, spent, res = os.environ["GEMINI_API_KEY"], json.load(open(spec)), 0.0, []
    rng = random.Random(7)
    for it in items:
        votes = []
        for i in range(k):
            if spent >= stop:
                break
            if mode == "pair":
                flip = rng.random() < 0.5 if i else i == 1  # first repeat in order a,b; the rest randomised
                x, y = (it["b_file"], it["a_file"]) if flip else (it["a_file"], it["b_file"])
                j, c = ask(key, [{"text": P_PAIR}, {"text": "A:"}, part(x), {"text": "B:"}, part(y)], 0.0 if i < 2 else 0.7)
                w = (j or {}).get("winner")
                votes.append({"flip": flip, "pick": None if w not in ("A", "B") else (("b" if w == "A" else "a") if flip else ("a" if w == "A" else "b"))})
            else:
                j, c = ask(key, [{"text": P_GENRE if mode == "genre" else P_POINT}, part(it["file"])], 0.7 if i else 0.0)
                votes.append(j)
            spent += c
            time.sleep(1)
        row = {**it, "votes": votes}
        if mode == "pair":
            picks = [v["pick"] for v in votes if v["pick"]]
            a, b = picks.count("a"), picks.count("b")
            row["verdict"] = "a" if a >= 2 and a > 2 * b else "b" if b >= 2 and b > 2 * a else "no_call"
            row["slot_a_share"] = round(sum(1 for v in votes if (v["pick"] == "a") != v["flip"] and v["pick"]) / max(1, len(picks)), 2)  # share of picks that went to slot A
        elif mode == "point":
            for f in ("singing", "production"):
                vals = [v[f] for v in votes if v and isinstance(v.get(f), (int, float))]
                row[f"{f}_median"] = statistics.median(vals) if vals else None
        else:
            row["genre_mode"] = max(set(g := [(v or {}).get("genre") for v in votes]), key=g.count) if votes else None
        res.append(row)
    json.dump({"mode": mode, "model": MODEL, "k": k, "spent_usd_est": round(spent, 4), "results": res}, open(out, "w"), indent=1)
    print("estimated spend USD", round(spent, 4))


if __name__ == "__main__":
    a = sys.argv
    if "--hard-stop-usd" not in a:
        sys.exit("refusing to run without --hard-stop-usd")
    main(a[1], a[2], a[3], float(a[a.index("--hard-stop-usd") + 1]), int(a[a.index("--k") + 1]) if "--k" in a else 3)
