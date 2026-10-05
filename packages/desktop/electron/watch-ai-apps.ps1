$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TokscaleForeground {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@

function DesktopRecord($appProcess) {
    try {
        if ($appProcess.ProcessName -notin @('Claude', 'ChatGPT', 'Codex')) { return $null }
        $exePath = $appProcess.Path
        if (!$exePath) { return $null }
        return @{ pid = $appProcess.Id; name = $appProcess.ProcessName; path = $exePath }
    } catch { return $null }
}

$lastSnapshot = ''
while ($true) {
    try {
        $desktopApps = @(Get-Process -Name Claude,ChatGPT,Codex -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Sort-Object Id | ForEach-Object { DesktopRecord $_ })
        $foreground = $null
        $focusedWindow = [TokscaleForeground]::GetForegroundWindow()
        [uint32]$focusedProcessId = 0
        [void][TokscaleForeground]::GetWindowThreadProcessId($focusedWindow, [ref]$focusedProcessId)
        if ($focusedProcessId -gt 0) {
            $focusedProcess = Get-Process -Id $focusedProcessId -ErrorAction SilentlyContinue
            if ($focusedProcess) {
                $foreground = DesktopRecord $focusedProcess
                if ($foreground) { $foreground.windowId = $focusedWindow.ToInt64().ToString() }
            }
        }
        $snapshot = @{ apps = $desktopApps; foreground = $foreground } | ConvertTo-Json -Depth 4 -Compress
        if ($snapshot -ne $lastSnapshot) {
            [Console]::WriteLine($snapshot)
            $lastSnapshot = $snapshot
        }
    } catch {
        [Console]::WriteLine('{"error":"Desktop app detection failed; retrying."}')
    }
    Start-Sleep -Milliseconds 1500
}
