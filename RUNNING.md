# Run QBank + LB Together

From this project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

The launcher starts:

- QBank backend: `backend` on `http://localhost:5000`
- QBank frontend: `frontend` on `http://localhost:5173`
- LB backend folder: `.\LB`
- LB gateway ports: `8070`, `8090`, `8100`

To use a different LB folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1 -LbRoot "C:\path\to\LB"
```

Press `Ctrl+C` in the launcher terminal to stop the processes it started.
