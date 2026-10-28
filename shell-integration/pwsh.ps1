# CIBoard shell integration for Windows PowerShell 5.1 and PowerShell 7.
#
# Loaded with:  -NoExit -Command ". '<this file>'"
# It runs AFTER the user's profile, wraps whatever `prompt` the profile defined (oh-my-posh etc.)
# and never writes to any profile file.
#
# Emits OSC 133 (A prompt start, B prompt end, C output start, D command end) plus
# OSC 633;P;Cwd=<dir> and OSC 633;E;<command line>. Passwords typed at prompts such as
# Read-Host are never part of a command line: only the line submitted to the shell is reported.

if ($Global:__CIBoardIntegration) { return }
$Global:__CIBoardIntegration = $true
$Global:__CIBoardLastHistoryId = -1
$Global:__CIBoardErrorCount = 0
$Global:__CIBoardLastError = $null
$Global:__CIBoardOriginalPrompt = $function:prompt

# Escape for OSC 633;E: backslash, ';' and control characters become \\ and \xNN.
function Global:__CIBoard-Escape([string]$Text) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $Text.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($ch -eq ';') { [void]$sb.Append('\x3b') }
        elseif ($code -lt 32) { [void]$sb.Append(('\x{0:x2}' -f $code)) }
        else { [void]$sb.Append($ch) }
    }
    $sb.ToString()
}

function Global:prompt {
    $success = $?
    $lastExit = $global:LASTEXITCODE
    $esc = [char]27
    $bel = [char]7
    $out = ''

    # Report the previous command's exit code once per executed command (not for empty lines).
    $last = Get-History -Count 1
    if ($last -and $last.Id -ne $Global:__CIBoardLastHistoryId) {
        $Global:__CIBoardLastHistoryId = $last.Id
        $code = 0
        if (-not $success) {
            # $LASTEXITCODE only describes this command if it is a native one. A new $Error record
            # means a PowerShell error (exit 1), otherwise trust the native exit code.
            $newError = ($Error.Count -gt 0) -and ($Error.Count -ne $Global:__CIBoardErrorCount -or -not [object]::ReferenceEquals($Error[0], $Global:__CIBoardLastError))
            if (-not $newError -and ($lastExit -is [int]) -and ($lastExit -ne 0)) { $code = $lastExit } else { $code = 1 }
        }
        $out += "$esc]133;D;$code$bel"
    }
    else {
        $out += "$esc]133;D$bel"
    }

    $Global:__CIBoardErrorCount = $Error.Count
    $Global:__CIBoardLastError = if ($Error.Count -gt 0) { $Error[0] } else { $null }

    $location = $ExecutionContext.SessionState.Path.CurrentLocation
    if ($location.Provider.Name -eq 'FileSystem') {
        $out += "$esc]633;P;Cwd=$($location.ProviderPath)$bel"
    }
    $out += "$esc]133;A$bel"

    $original = ''
    if ($Global:__CIBoardOriginalPrompt) { $original = & $Global:__CIBoardOriginalPrompt }
    $global:LASTEXITCODE = $lastExit

    $out + $original + "$esc]133;B$bel"
}

# PSReadLine returns from ReadLine() the moment Enter is pressed and before the command runs,
# which is the one place where "output starts" (C) and the full command line are known.
if ((Get-Module PSReadLine) -and ('Microsoft.PowerShell.PSConsoleReadLine' -as [type])) {
    function Global:PSConsoleHostReadLine {
        $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext)
        if ($line -and $line.Trim()) {
            $esc = [char]27
            $bel = [char]7
            [Console]::Write("$esc]633;E;$(__CIBoard-Escape $line)$bel$esc]133;C$bel")
        }
        $line
    }
}
