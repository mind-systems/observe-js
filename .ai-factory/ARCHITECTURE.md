# Architecture: Structured Modules (Technical Layers)

## Folder Structure

```
src/
├── core/          # Platform-neutral: record model, OTLP encoder, batcher, exporter, resource attrs
├── node/          # Node entry: AsyncLocalStorage context, Winston transport adapter
└── browser/       # Browser entry: Zone context, framework-agnostic wrapper
```

`package.json` conditional `exports` selects `node/` or `browser/` automatically — no runtime branching.

## Dependency Rules

- `core/` → nothing outside itself
- `node/` → `core/` only
- `browser/` → `core/` only
- ❌ `node/` and `browser/` never import each other
- ❌ `core/` never imports Node or browser globals

## OTLP Wire Shape

Resource-level (set once per `init`): `project`, `service.name`, `service.instance.id`
Record-level: `severityText`, `body`, `timeUnixNano`, `trace_id` attribute

High-cardinality fields stay in record attributes — never promoted to resource level.
This shape is frozen cross-platform; changes here require coordinated changes in observe-swift and observe-dart.
