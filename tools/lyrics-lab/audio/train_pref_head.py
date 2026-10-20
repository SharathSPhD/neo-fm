#!/usr/bin/env python3
"""Bradley-Terry preference head on [CLAP embedding, Audiobox aesthetics] trained on Music Arena A/B battles.
score(x) = MLP(x); P(A beats B) = sigmoid(score(A) - score(B)). Split by battle id (hash, 80/20), so no battle leaks across splits.
Reports held-out pairwise accuracy for: the head, aesthetics-only (sum of CE+CU+PC+PQ), PQ-only, and random (0.5, plus a shuffled-label check).
python audio/train_pref_head.py [--feats data/arena_feats] [--epochs 60] [--out data/pref_head.pt]"""
import argparse, hashlib, json
import numpy as np, torch, torch.nn as nn

def split_of(uuid): return int(hashlib.md5(uuid.encode()).hexdigest(), 16) % 10 < 8  # True = train

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--feats", default="data/arena_feats"); ap.add_argument("--epochs", type=int, default=60); ap.add_argument("--out", default="data/pref_head.pt")
    ap.add_argument("--hidden", type=int, default=128); ap.add_argument("--wd", type=float, default=1e-2); ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(); torch.manual_seed(a.seed); np.random.seed(a.seed)
    z = np.load(a.feats + ".npz"); idx = {p: i for i, p in enumerate(z["clip_ids"])}
    X = np.concatenate([z["clap"], z["aes"]], 1).astype(np.float32)
    mu, sd = X[:, 512:].mean(0), X[:, 512:].std(0) + 1e-6; X[:, 512:] = (X[:, 512:] - mu) / sd  # standardise aesthetics only; CLAP is unit-norm
    B = [json.loads(l) for l in open(a.feats + "_battles.jsonl", encoding="utf-8")]
    def pairs(rows):  # (winner_idx, loser_idx)
        return np.array([(idx[b["a"]], idx[b["b"]]) if b["winner"] == "A" else (idx[b["b"]], idx[b["a"]]) for b in rows])
    tr, te = pairs([b for b in B if split_of(b["battle_uuid"])]), pairs([b for b in B if not split_of(b["battle_uuid"])])
    print(f"battles: train {len(tr)}, held-out {len(te)}")
    Xt = torch.from_numpy(X)
    net = nn.Sequential(nn.Linear(X.shape[1], a.hidden), nn.GELU(), nn.Dropout(0.2), nn.Linear(a.hidden, 1))
    opt = torch.optim.AdamW(net.parameters(), 1e-3, weight_decay=a.wd)
    def acc(f, p): return float((f(torch.from_numpy(p[:, 0])) > f(torch.from_numpy(p[:, 1]))).float().mean())
    head = lambda i: net(Xt[i]).squeeze(-1)
    for ep in range(a.epochs):
        net.train(); perm = np.random.permutation(len(tr))
        for s in range(0, len(perm), 128):
            b = torch.from_numpy(tr[perm[s:s + 128]]); loss = -torch.nn.functional.logsigmoid(head(b[:, 0]) - head(b[:, 1])).mean()
            opt.zero_grad(); loss.backward(); opt.step()
        if ep % 10 == 9:
            net.eval()
            with torch.no_grad(): print(f"epoch {ep + 1} loss {loss.item():.4f} heldout_acc {acc(head, te):.4f}")
    net.eval(); raw = torch.from_numpy(z["aes"])
    with torch.no_grad():
        res = {"n_heldout_battles": len(te), "bt_head": acc(head, te), "aesthetics_sum": acc(lambda i: raw[i].sum(1), te), "pq_only": acc(lambda i: raw[i][:, 3], te),
               "ce_only": acc(lambda i: raw[i][:, 0], te), "random": 0.5,
               "random_scores_check": float(np.mean([acc(lambda i: torch.rand(len(i)), te) for _ in range(50)]))}
        # 95% binomial interval on the held-out accuracy so the table is not over-read
        p = res["bt_head"]; res["bt_head_ci95"] = round(1.96 * (p * (1 - p) / max(1, len(te))) ** 0.5, 4)
    print(json.dumps({k: round(v, 4) if isinstance(v, float) else v for k, v in res.items()}, indent=1))
    torch.save({"state": net.state_dict(), "aes_mu": mu, "aes_sd": sd}, a.out)
    json.dump(res, open(a.out.replace(".pt", "_results.json"), "w"), indent=1)

if __name__ == "__main__": main()
