## Ralph evidence — Sprint 1 (privacy)

### (a) Grep gate
```
$ grep -riE "github\.com|heartmula|svara-tts|parler-tts|apache-2|view source|kenpath" apps/web/app apps/web/components
(no hits)
```

### (b) GitHub repo visibility
```
$ gh repo view SharathSPhD/neo-fm --json visibility
{"visibility":"PRIVATE"}
```

### (c) docs/ tracked files
```
$ git ls-files docs/ | head
(0 tracked files)
```

### (d) Working tree intact (docs/ still on disk)
```
$ ls -d docs && ls docs/ | head -5
docs
ARCHITECTURE.md
contracts
DECISIONS
IMPLEMENTATION_PLAN.md
licenses
```
