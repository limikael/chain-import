# chain-import

Compose and execute exports from multiple packages as a single interface.

`chain-import` lets you build **zero-configuration plugin systems** using standard Node.js dependency resolution and `package.json` exports. It discovers plugins automatically, merges their exported functions, and executes them using a **declarative contract system**.

---

## Installation

```bash
npm install chain-import
```

---

## Quick Example

```js
import { chainImport } from "chain-import";

const chain = await chainImport({
  cwd: process.cwd(),
  exportPath: "build"
});

await chain.build({ messages: [] });
```

---

## Core Idea

- Packages export functions via `package.json` exports
- `chain-import` discovers them automatically
- Functions with the same name are grouped
- Execution is controlled by **contracts**

---

## Function Contracts

Contracts define:

- **how many functions run**
- **how they run**
- **how return values are handled**

### Result Contracts (choose one)

- `procedural` → ignore return values
- `collect` → return array of all results
- `collect-flat` → flatten one level
- `first-defined` → return first non-undefined result

### Execution Contracts (choose one)

- `sync` → call synchronously (Promise = error)
- `async` → sequential `await`
- `async-parallel` → `Promise.all`

### Example

```js
chainSetContract(chain, "init", "first-defined", "async");
chainSetContract(chain, "build", "procedural", "async");
chainSetContract(chain, "clientInit", "procedural", "sync");
chainSetContract(chain, "routes", "collect-flat", "async-parallel");
```

### Rules

- Exactly **one result contract**
- Exactly **one execution contract**
- Invalid combinations (e.g. `first-defined + async-parallel`) throw errors

---

## Plugin Example

### `package.json`

```json
{
  "name": "my-plugin",
  "exports": {
    "./build": "./build.js"
  },
  "keywords": ["my-plugin"]
}
```

### `build.js`

```js
export async function build(ctx) {
  ctx.messages.push("hello from plugin");
}
```

---

## Execution Order

```js
export async function build(ctx) {}
build.priority = 5;
```

- Lower number = earlier execution
- Default = `10`

---

## Plugin Discovery

- Starts from `cwd` and `roots`
- Expands:
  - dependencies
  - workspaces (`workspaceKey`)
- Filters by:
  - `keyword`
  - `exportPath`

---

## Visibility

Plugins can be **internal**:

- hidden from `lsmod`
- cannot be enabled/disabled
- still executed

Internal is computed as:

- plugin metadata
- OR caller override
- OR structural rule (roots except cwd)

---

## Enabling / Disabling Plugins

### Project config

```json
{
  "enablePlugins": ["plugin-a"],
  "disablePlugins": ["plugin-b"]
}
```

### Rules

- default: enabled
- disable overrides enable
- internal plugins cannot be modified

---

## API

### chainImport

```js
const chain = await chainImport(options);
```

Creates executable chain.

---

### chainLoadMeta

```js
const meta = await chainLoadMeta(options);
```

Loads metadata without executing.

---

### chainList

```js
const list = await chainList(meta);
```

Returns plugin list.

---

### chainEnable / chainDisable

```js
await chainEnable(meta, "plugin");
await chainDisable(meta, "plugin");
```

---

### chainSetContract

```js
chainSetContract(chain, method, ...tokens);
```

Defines execution contract.

---

### chainAttachCommanderCommand

```js
chainAttachCommanderCommand(chain, program, "publish");
```

Attach CLI commands.

---

## Options

```js
{
  cwd,
  roots,
  keyword,
  exportPath,
  conditions,
  workspaceKey,
  defaultEnableKey,
  enableKey,
  disableKey,
  internalKey,
  internal,
  contracts
}
```

### Key Options

- `cwd` → main project root
- `roots` → additional roots
- `keyword` → plugin filter
- `exportPath` → entrypoint
- `workspaceKey` → workspace support (e.g. "workspaces")
- `internal` → force internal plugins
- `contracts` → predefined contracts

---

## Design Principles

- Zero configuration
- Convention over configuration
- Deterministic execution
- Explicit contracts
- Minimal abstraction

---

## Summary

`chain-import` turns your dependency graph into a **declarative execution system**.

- discovery via packages
- composition via function names
- execution via contracts
