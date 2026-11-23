# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's
[Security Advisories](https://github.com/Hagkiest/dsh-transcode-tty/security/advisories/new)
form. If that is unavailable, open an issue that says only "security report —
please contact me" with no details, and a maintainer will reach out.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- The version, Node version, and operating system.
- Any suggested mitigation.

You can expect an acknowledgement within a few days and a status update within a
week. Once a fix is ready, the advisory is published with credit unless you ask
otherwise.

## Threat model

This plugin runs in the Harness Host process with the same privileges as the
agent, and it processes text that commands produced. That shape defines what
matters:

### What the plugin does with untrusted input

It treats tool output as **data, never as instructions or code**. Every function in
`src/normalize.js` is a pure `string → string` transform built from regular
expressions and character-code arithmetic. There is no `eval`, no `new Function`,
no dynamic `import`, no shell invocation, and no file or network access anywhere
in `src/`.

### Areas worth scrutiny

| Area | Considered risk |
| --- | --- |
| Regular expressions | ReDoS. All patterns in `stripAnsi` are linear over the input; the OSC pattern uses a lazy quantifier bounded by the terminator. |
| `maxTextLength` | Bounds the work per result, so a pathologically large block cannot stall the Host. |
| Unicode handling | Lone surrogates and malformed sequences must not throw; both are covered by tests. |
| The reverse map | Built once, lazily, from a fixed byte range. It allocates on the order of tens of thousands of entries and never grows with input. |

### What the plugin does not do

- It does not read files, open sockets, or spawn processes.
- It does not persist anything.
- It does not send output anywhere.
- It does not modify the structured tool result, so exit codes and error state
  seen by the agent are unaffected by any transform.

### Install scripts

`install.ps1`, `install.sh`, and `scripts/install.mjs` run with your privileges
and modify your DSH profile. They:

- Back up the profile's `package.json` before the first change.
- Register the plugin as a `link:` dependency, so the profile points at your
  checkout rather than a copy.
- Run your profile's package manager (`pnpm`, via `corepack`, or via `npx`).

Read them before running them. Nothing in them is obfuscated, and the installer
prints every step it takes.

## Dependencies

The only runtime dependency is `@deepseek-ai/schemastery`, used solely to build
the configuration schema. The Cordis context is passed in by the runtime as an
argument, never imported, so this package declares no dependency on it.
`src/normalize.js` has no dependencies at all, which keeps the
security-sensitive part of the codebase free of third-party code.
