<#
.SYNOPSIS
  Downscale a RenderDoc PNG export for inline use in a blog post.

.DESCRIPTION
  Blog images stay PNG (pixel-exact — see the design spec for the measured reason
  lossy formats are unsuitable for data buffers), but are capped in width so the
  repo does not carry 2560px originals for a ~1080px column.

  Note that downscaling resamples values: a downscaled normal buffer contains
  *blended* normals. That is fine as a visual. Where exact values matter, link the
  full-resolution original alongside the inline image.

.EXAMPLE
  .\resize-blog-image.ps1 -Source "..\analysis\gb_t0.png" `
                          -Dest "..\public\img\blog\bg3\07-gbuffer-mrt0-normals.png"
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Dest,
  [int]$MaxWidth = 1600
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "Source not found: $Source" }

$dir = Split-Path $Dest -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

$src = [System.Drawing.Bitmap]::FromFile($Source)
try {
  if ($src.Width -le $MaxWidth) {
    $src.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $outW = $src.Width; $outH = $src.Height
  }
  else {
    $scale = $MaxWidth / $src.Width
    $outW = $MaxWidth
    $outH = [int][math]::Round($src.Height * $scale)

    $bmp = New-Object System.Drawing.Bitmap($outW, $outH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($src, 0, 0, $outW, $outH)
    $g.Dispose()
    $bmp.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
}
finally {
  $src.Dispose()
}

$kb = [int]((Get-Item $Dest).Length / 1KB)
"{0,-42} {1}x{2}  {3} KB" -f (Split-Path $Dest -Leaf), $outW, $outH, $kb
