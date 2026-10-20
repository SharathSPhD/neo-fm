import json, sys, os, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(__file__)); import gem
J="gemini-3.1-pro-preview"
DIMS=["meter_singability","rhyme_prasa","imagery","diction_register","cultural_fit","brief_fidelity"]
RUBRIC="""You are a senior lyricist and native-level editor in the given Indian language. Two song lyrics were written for the same brief and the same 30-second structure. Score each 1-5 (integers; 3 competent, 5 outstanding) on:
- meter_singability: paired lines have matching syllable counts and a steady beat; the words fall naturally on a tune; no tongue-twisting clusters
- rhyme_prasa: the rhyme / prasa / edugai / antyaprasa the style expects, used naturally without forcing
- imagery: fresh, specific, concrete images; no stock film-lyric clichés
- diction_register: native, idiomatic, one consistent register, correct spelling in native script, not translated-sounding, no stray English
- cultural_fit: faithful to the culture, season, ritual and emotion the brief names
- brief_fidelity: names, occasion and concrete asks of the brief are present and meaningful
Judge quality, not length. You do not know how either was made. Then choose overall "winner": "A", "B" or "tie".
Reply with ONLY JSON: {"reason":"<=40 words","A":{dims...},"B":{dims...},"winner":"A|B|tie"}"""
def once(b,a,c):
    t=gem.call(J,f"Language: {b['language']}\nStyle: {b['style']}\nBrief: {b['brief']}\n\n=== LYRIC A ===\n{a}\n\n=== LYRIC B ===\n{c}",system=RUBRIC,temp=0.2,json_out=True)
    j=json.loads(t[t.index("{"):t.rindex("}")+1])
    for k in "AB":
        for d in DIMS: assert 1<=j[k][d]<=5
    return j
def pair(b,x,y):
    """x vs y, both orders. returns dict with x_win in {1,0.5,0} and dim diffs (x-y)."""
    try:
        j1=once(b,x,y); j2=once(b,y,x)
    except Exception as e: return None
    diff={d:((j1["A"][d]-j1["B"][d])+(j2["B"][d]-j2["A"][d]))/2 for d in DIMS}
    tot=sum(diff.values()); w=1 if tot>=1 else 0 if tot<=-1 else 0.5
    v=[(j1["winner"]=="A")-(j1["winner"]=="B"),(j2["winner"]=="B")-(j2["winner"]=="A")]
    return {"x_win":w,"diff":diff,"tot":tot,"votes":v}
def compare(armx,army,subset=None):
    BR={b['id']:b for b in json.load(open("briefs.json"))}
    X=json.load(open(f"arms/{armx}.json")); Y=json.load(open(f"arms/{army}.json"))
    ids=[i for i in X if i in Y and (subset is None or i in subset)]
    with cf.ThreadPoolExecutor(6) as ex: res=list(ex.map(lambda i:(i,pair(BR[i],X[i],Y[i])),ids))
    res={i:r for i,r in res if r}
    json.dump(res,open(f"arms/cmp_{armx}_vs_{army}.json","w"),indent=1)
    n=len(res); w=sum(r["x_win"]==1 for r in res.values()); l=sum(r["x_win"]==0 for r in res.values())
    dm={d:round(sum(r["diff"][d] for r in res.values())/n,2) for d in DIMS}
    print(f"{armx} vs {army}: n={n} wins={w} losses={l} ties={n-w-l} winrate={ (w+0.5*(n-w-l))/n:.2f} dimdiff={dm}")
    bylang={}
    for i,r in res.items(): bylang.setdefault(i[:2],[]).append(r["x_win"])
    print({k:round(sum(v)/len(v),2) for k,v in bylang.items()})
if __name__=="__main__": compare(sys.argv[1],sys.argv[2])
