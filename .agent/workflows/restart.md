---
description: How to restart Giorgio (kill stale processes and start fresh)
---

// turbo-all

## Restart Giorgio

1. Kill any running tsx processes and free port 3100:
```bash
pkill -f "tsx" 2>/dev/null; sleep 2; lsof -ti:3100 | xargs kill -9 2>/dev/null; sleep 1; echo "cleared"
```

2. Start Giorgio:
```bash
npm run dev 2>&1
```
