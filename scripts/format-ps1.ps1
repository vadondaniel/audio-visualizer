$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Get-ChildItem -Path $root -Recurse -File -Filter "*.ps1" |
    Where-Object {
        $_.FullName -notmatch '[\\/](node_modules|\.git|bin|obj|publish)[\\/]'
    } |
    ForEach-Object {
        $path = $_.FullName

        # Read as raw text, then normalize all line endings to LF.
        $text = [System.IO.File]::ReadAllText($path)
        $text = $text -replace "`r`n", "`n"
        $text = $text -replace "`r", "`n"

        $formatted = Invoke-Formatter -ScriptDefinition $text

        # Write formatter output using CRLF, matching normal Windows PowerShell files.
        $formatted = $formatted -replace "`r`n", "`n"
        $formatted = $formatted -replace "`r", "`n"
        $formatted = $formatted -replace "`n", "`r`n"

        [System.IO.File]::WriteAllText(
            $path,
            $formatted,
            [System.Text.UTF8Encoding]::new($false)
        )

        Write-Host "Formatted $($path.Substring($root.Length + 1))"
    }
