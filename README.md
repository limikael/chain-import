# chain-import

Compose and execute exports from multiple packages as a single interface.

`chain-import` lets you build **zero-configuration plugin systems** using standard Node.js dependency resolution and `package.json` exports. It discovers plugins automatically, merges their exported functions, and executes them in a predictable order.

## Installation

```bash
npm install chain-import
```

## Quick Example

```js
import { chainImport } from "chain-import";

const chain = await chainImport({
  cwd: process.cwd(),
  exportPath: "build"
});

await chain.build({ messages: [] });
```

If multiple plugins implement `build`, all of them will be executed in sequence.

## How It Works

1. `chain-import` scans your project's **dependencies**
2. It finds packages that expose a given export path
3. It imports those modules
4. It merges their exported functions
5. Calling a method executes all implementations

## Plugin Example

### `package.json`

```json
{
  "name": "my-plugin",
  "exports": {
    "./build": "./build.js"
  }
}
```

### `build.js`

```js
export async function build(ctx) {
  ctx.messages.push("hello from plugin");
}
```

## Multiple Plugins

If multiple plugins export the same function:

```js
export async function build(ctx) { ... }
```

Then:

```js
await chain.build(ctx);
```

Will call all implementations sequentially.

## Execution Order

Plugins can define priority:

```js
export async function build(ctx) {
  // ...
}

build.priority = 5;
```

* Lower number = earlier execution
* Default priority = `10`

## Error Handling

* Execution is **fail-fast**
* If a plugin throws, remaining plugins are not executed

## Return Values

* Return values are ignored
* Plugins should mutate the provided context object

## Plugin Discovery

* Recursively scans `dependencies`
* Ignores `devDependencies` and others
* Uses Node.js module resolution

### Filtering by keyword

```js
const chain = await chainImport({
  cwd: process.cwd(),
  exportPath: "build",
  keyword: "my-plugin"
});
```

Only packages with that keyword in `package.json` are included.

## Enabling / Disabling Plugins

### Plugin default

Plugins can define:

```json
{
  "defaultEnable": true
}
```

If omitted → defaults to enabled.

### Project configuration

```json
{
  "enablePlugins": ["plugin-a"],
  "disablePlugins": ["plugin-b"]
}
```

* Matches exact package names
* No partial matching

### Rules

1. Start with plugin default (`true` if unspecified)
2. Apply overrides:

   * `disablePlugins` → force disabled
   * `enablePlugins` → force enabled

If a plugin appears in both lists:

* Behavior is undefined (do not rely on it)

## Metadata API

### Load metadata

```js
import { chainLoadMeta } from "chain-import";

const meta = await chainLoadMeta({
  cwd: process.cwd(),
  exportPath: "build"
});
```

### List plugins

```js
import { chainList } from "chain-import";

const list = await chainList(meta);
```

Returns:

```js
[
  {
    name: "pk-info",
    description: "Provide system info",
    enabled: true
  }
]
```

## Enable / Disable via API

```js
import { chainEnable, chainDisable } from "chain-import";

await chainEnable(meta, "my-plugin");
await chainDisable(meta, "other-plugin");
```

This updates the project's `package.json`.

## Commander Integration

`chain-import` can be used to build plugin-based CLI tools with `commander`.

### Setup

```js
import { program } from "commander";
import { chainImport, chainAttachCommanderCommand } from "chain-import";

const chain = await chainImport({
  cwd: process.cwd(),
  exportPath: "cli"
});

chainAttachCommanderCommand(chain, program, "publish")
  .option("--edge, -e", "Publish to edge")
  .argument("<file>", "File to publish")
  .description("Publish project");

await program.parseAsync(process.argv);
```

### Plugin command

```js
export async function publish({ edge, args }) {
  console.log("Publishing", args[0], edge ? "to edge" : "");
}
```

### Behavior

* Each plugin can implement the command
* All implementations are executed
* Same rules apply:

  * priority ordering
  * fail-fast execution
  * no return values

## When to Use

* Plugin-based systems
* Extensible build pipelines
* CLI tools with pluggable commands
* Systems where behavior should be composed from dependencies

## Design Principles

* Zero configuration
* Convention over configuration
* Uses standard Node.js features (`exports`, dependencies)
* Deterministic execution
* Simple mental model

## Summary

`chain-import` turns your dependency graph into a plugin system.

Define behavior in packages, export functions, and let `chain-import` compose and execute them.
