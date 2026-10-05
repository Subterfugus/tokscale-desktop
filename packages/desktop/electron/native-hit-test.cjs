const { execFile } = require("node:child_process");
const path = require("node:path");

// Smoke-only Windows probe. WM_NCHITTEST queries native behavior without
// moving the mouse, showing a window, or interacting with the user's apps.
async function nativeHitTest(window, points) {
  if (process.platform !== "win32") return null;
  const handle = window.getNativeWindowHandle().readBigUInt64LE().toString();
  const [width, height] = window.getContentSize();
  const payload = Buffer.from(JSON.stringify({ handle, width, height, points })).toString("base64");
  const source = `
$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TokscaleHitTest {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; }
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref Point p);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
}
'@
[void][TokscaleHitTest]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$widgetHandle = [IntPtr]::new([long]$data.handle)
$rect = [TokscaleHitTest+Rect]::new()
if (![TokscaleHitTest]::GetClientRect($widgetHandle,[ref]$rect)) { throw 'Cannot read widget geometry' }
$results = @($data.points | ForEach-Object {
 $point = [TokscaleHitTest+Point]::new()
 $point.x = [int][Math]::Round($_.x * ($rect.right - $rect.left) / $data.width)
 $point.y = [int][Math]::Round($_.y * ($rect.bottom - $rect.top) / $data.height)
 [void][TokscaleHitTest]::ClientToScreen($widgetHandle,[ref]$point)
 $packed = [long](($point.y -band 65535) -shl 16) -bor ($point.x -band 65535)
 $hit = [IntPtr]::Zero
 if ([TokscaleHitTest]::SendMessageTimeout($widgetHandle,0x84,[IntPtr]::Zero,[IntPtr]::new($packed),2,1000,[ref]$hit) -eq [IntPtr]::Zero) { throw 'Widget hit test timed out' }
 @{ name = $_.name; hit = $hit.ToInt64() }
})
ConvertTo-Json -InputObject $results -Compress
`;
  const stdout = await new Promise((resolve, reject) => {
    execFile(path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")],
      { windowsHide: true, shell: false, timeout: 15000, maxBuffer: 65536 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  return JSON.parse(stdout.trim());
}
module.exports = { nativeHitTest };
