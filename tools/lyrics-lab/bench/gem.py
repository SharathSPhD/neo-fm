import os, json, time, urllib.request, urllib.error, threading
KEY=os.environ["GEMINI_API_KEY"]; USAGE={}; _l=threading.Lock()
def call(model, prompt, system=None, temp=1.0, json_out=False, max_tokens=8192, tries=6):
    body={"contents":[{"role":"user","parts":[{"text":prompt}]}],"generationConfig":{"temperature":temp,"maxOutputTokens":max_tokens}}
    if system: body["systemInstruction"]={"parts":[{"text":system}]}
    if json_out: body["generationConfig"]["responseMimeType"]="application/json"
    url=f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={KEY}"
    for t in range(tries):
        try:
            req=urllib.request.Request(url,json.dumps(body).encode(),{"content-type":"application/json"})
            r=json.load(urllib.request.urlopen(req,timeout=120))
            u=r.get("usageMetadata",{})
            with _l:
                a=USAGE.setdefault(model,[0,0]); a[0]+=u.get("promptTokenCount",0); a[1]+=u.get("candidatesTokenCount",0)+u.get("thoughtsTokenCount",0)
            parts=r["candidates"][0]["content"]["parts"]
            return "".join(p.get("text","") for p in parts).strip()
        except urllib.error.HTTPError as e:
            if e.code in (429,500,503): time.sleep(2*2**t); continue
            raise
        except Exception: time.sleep(2*2**t)
    raise RuntimeError("gemini failed")
