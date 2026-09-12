# Architecture diagrams

The canonical diagrams live as Mermaid in [`../architecture.md`](../architecture.md) and render
natively on GitHub and in the submission. The Mermaid sources are also extracted here so they can be
exported to raster/vector for slides or the submission portal:

- `architecture-flow.mmd` — component / data-flow diagram (web → api/agent → Arc + The Graph + CRE).
- `architecture-state.mmd` — the `AssuranceHub` protocol state machine.
- `architecture.png` — exported component/data-flow diagram (Arc track requires an architecture diagram).

## Re-export

```bash
npx @mermaid-js/mermaid-cli -i docs/diagrams/architecture-flow.mmd  -o docs/diagrams/architecture.png -b white -w 1600
npx @mermaid-js/mermaid-cli -i docs/diagrams/architecture-state.mmd -o docs/diagrams/architecture-state.png -b white -w 1600
```

> PNG (not SVG) is preferred: a browser-exported SVG can bake in absolute local paths / tokens, which
> `pnpm gate:secrets` text-scans committed SVGs for. Keep exports metadata-clean (`exiftool -all=`).
