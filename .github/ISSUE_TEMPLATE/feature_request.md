---
name: Feature request
about: A transform, a mojibake direction, or an option this plugin should handle
title: ''
labels: enhancement
assignees: ''
---

## The problem

<!-- What are you seeing that the plugin does not handle? Be concrete: the output,
     the command, and why it is wrong. -->

## What you expected

<!-- What should the output look like instead? -->

## Which part of the pipeline

- [ ] ANSI / escape sequences
- [ ] Carriage returns / progress redraws
- [ ] A new mojibake direction
- [ ] An improvement to an existing direction
- [ ] Control characters or space variants
- [ ] A new configuration option
- [ ] Install / uninstall / verify scripts
- [ ] Documentation

## Raw bytes

<!-- If this is about an encoding problem, attach the bytes:

    your-command | Format-Hex        # Windows
    your-command | xxd               # macOS / Linux
-->

```text
paste the hex dump here
```

## Would this be opt-in?

<!--
Some transforms change intended layout or hide information, so they default to
off. Does this one need to be opt-in? If you are not sure, say so.
-->

## Alternatives you considered

<!-- Including "fix it at the source" — if the tool should just emit UTF-8, say so. -->
