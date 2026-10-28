# cmd.exe shell integration

`cmd.exe` has no startup hook and no pre-command hook, so CIBoard integrates it purely through the
`PROMPT` environment variable it sets on the spawned process. Nothing is written to the registry
or to any file.

```
PROMPT = $E]133;D$E\ $E]633;P;Cwd=$P$E\ $E]133;A$E\ <original prompt, default $P$G> $E]133;B$E\
```

(without the spaces; `$E` is ESC, `$E\` is the string terminator, `$P` the current directory.)

What that gives us, and what it does not:

| Marker | Source |
| --- | --- |
| A / B (prompt start / end) | emitted by `PROMPT` |
| cwd | `OSC 633;P;Cwd=` from `PROMPT` |
| C (output start) | **not available**; inferred when the cursor leaves the line that follows marker B |
| command text | read back from the screen row between marker B and Enter |
| exit code | **not available**: `PROMPT` cannot expand `%ERRORLEVEL%` per prompt, so entries say `exit ?` |

Limitations: commands that clear the screen or run full-screen programs while a command line is
being typed can confuse the inference, and `cmd /k` inside other shells does not inherit the effect
unless `PROMPT` is inherited (it is, as an environment variable).
