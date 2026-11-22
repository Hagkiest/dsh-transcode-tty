---
name: Bug report
about: Something is displayed wrong, changed incorrectly, or not changed at all
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- The output as the Harness displayed it, and what you expected instead. -->

## Which problem is it

- [ ] The plugin had no effect
- [ ] Output is still mojibake
- [ ] Correct text was changed
- [ ] Escape sequences are still visible
- [ ] The settings form does not appear
- [ ] Install or uninstall failed
- [ ] Something else

## Reproduce

The exact command, and the tool it ran through (`pwsh`, `bash`, `job_output`, or
another tool's name):

```powershell
# command here
```

## Raw bytes

<!--
For mojibake, the raw bytes are the most useful thing you can attach:

    your-command | Format-Hex        # Windows
    your-command | xxd               # macOS / Linux
-->

```text
paste the hex dump here
```

## Environment

| | |
| --- | --- |
| OS | |
| Node version (`node --version`) | |
| Harness version | |
| Console code page (`chcp`, Windows) | |
| Plugin version | |

## Self-check output

<!-- Output of: npm run verify -->

```text
paste here
```

## Configuration

<!-- Any non-default options from your profile's cordis.patch.yml, or "defaults". -->

```yaml
# your config
```

## Does it reproduce outside the plugin

<!--
    node --input-type=module -e "
    import { normalizeTerminalText } from 'file:///PATH/index.js';
    console.log(JSON.stringify(normalizeTerminalText('paste mojibake here')));
    "
-->

```text
paste here
```
