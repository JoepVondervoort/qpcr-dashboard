# Frontend

React and TypeScript interface of the qPCR Analysis Workbench, built with Vite.
See the [main README](../README.md) for installation and the development setup.

| Command | Purpose |
|---|---|
| `npm ci` | Install the locked dependencies |
| `npm run dev` | Development server; forwards `/api` to `http://127.0.0.1:8000` |
| `npm run build` | Type-check and build into `dist/` |
| `npm test` | Unit tests (`tests/*.test.mjs`) |
| `npm run lint` | Lint with oxlint |

The installed `qpcr-workbench` command serves the contents of `dist/` together with
the API, so the built interface needs no separate web server.
