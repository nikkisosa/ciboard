# CIBoard shell integration for bash (Git Bash and WSL).
#
# Started as:  bash --rcfile <this file> -i
# so the user's own files are never edited. This file first does what an interactive bash would
# normally do (sources the user's startup files), then adds OSC 133 / 633 markers.

if [ -n "$MSYSTEM" ]; then
    # Git Bash: behave like a login shell (PATH setup lives in /etc/profile) but stay in the cwd
    # CIBoard started us in instead of jumping to $HOME.
    export CHERE_INVOKING=1
    [ -f /etc/profile ] && . /etc/profile
    if [ -f "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
    elif [ -f "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
    elif [ -f "$HOME/.profile" ]; then . "$HOME/.profile"
    elif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"
    fi
else
    [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi

[ -n "$__ciboard_loaded" ] && return
__ciboard_loaded=1
__ciboard_in_prompt=1
__ciboard_cmd_started=0

# Escape for OSC 633;E: backslash, ';' and newlines.
__ciboard_escape() {
    local s=$1 out= i c
    for ((i = 0; i < ${#s}; i++)); do
        c=${s:i:1}
        case "$c" in
            '\') out+='\\' ;;
            ';') out+='\x3b' ;;
            $'\n') out+='\x0a' ;;
            $'\r') out+='\x0d' ;;
            *) out+=$c ;;
        esac
    done
    printf '%s' "$out"
}

# Runs before each command the user submits (DEBUG trap fires per simple command; only the first
# one after a prompt counts, and nothing fires while our own prompt hook runs).
__ciboard_preexec() {
    [ -n "$COMP_LINE" ] && return
    [ "$__ciboard_in_prompt" = 1 ] && return
    [ "$__ciboard_cmd_started" = 1 ] && return
    __ciboard_cmd_started=1
    local line
    line=$(HISTTIMEFORMAT= builtin history 1 2>/dev/null | sed 's/^ *[0-9]* *//')
    [ -z "$line" ] && line=$BASH_COMMAND
    printf '\e]633;E;%s\a\e]133;C\a' "$(__ciboard_escape "$line")"
}

__ciboard_prompt() {
    local ec=$?
    __ciboard_in_prompt=1
    if [ "$__ciboard_cmd_started" = 1 ]; then
        printf '\e]133;D;%s\a' "$ec"
    else
        printf '\e]133;D\a'
    fi
    __ciboard_cmd_started=0
    printf '\e]633;P;Cwd=%s\a' "$(pwd -W 2>/dev/null || pwd)"
    case "$PS1" in
        *'133;B'*) ;;
        *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
    esac
    return "$ec"
}

__ciboard_ready() { __ciboard_in_prompt=0; }

PROMPT_COMMAND="__ciboard_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND};__ciboard_ready"
# Respect a DEBUG trap the user already installed; without ours, markers fall back to screen
# inference in CIBoard.
if [ -z "$(trap -p DEBUG)" ]; then trap '__ciboard_preexec' DEBUG; fi
