[CmdletBinding()]
param(
  [switch]$Cleanup,
  [string]$WorkDirectory
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  throw "RUNNER_TEMP is required for ephemeral Windows signing files."
}
if ([string]::IsNullOrWhiteSpace($WorkDirectory)) {
  $WorkDirectory = Join-Path $env:RUNNER_TEMP "tarab-windows-signing"
}
$runnerTempPath = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$WorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
$runnerTempPrefix = $runnerTempPath.TrimEnd([char[]]"\/") + [IO.Path]::DirectorySeparatorChar
if (!$WorkDirectory.StartsWith($runnerTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The Windows signing directory must be a child of RUNNER_TEMP."
}

$certificateStore = "Cert:\CurrentUser\My"
$certificatePath = Join-Path $WorkDirectory "certificate.pfx"
$manifestPath = Join-Path $WorkDirectory "imported-certificates.json"
$manifestTempPath = Join-Path $WorkDirectory "imported-certificates.tmp"
$configurationPath = Join-Path $PSScriptRoot "../src-tauri/tauri.windows-signing.json"

function Get-StoreThumbprints {
  @(Get-ChildItem -Path $certificateStore | ForEach-Object { $_.Thumbprint.ToUpperInvariant() })
}

function Write-CleanupManifest {
  param(
    [string[]]$BaselineThumbprints,
    [string[]]$ImportedThumbprints
  )

  @{
    baselineThumbprints = @($BaselineThumbprints)
    importedThumbprints = @($ImportedThumbprints)
  } |
    ConvertTo-Json -Depth 3 |
    Set-Content -LiteralPath $manifestTempPath -Encoding utf8
  Move-Item -LiteralPath $manifestTempPath -Destination $manifestPath -Force
}

function Remove-SigningMaterial {
  $cleanupErrors = [Collections.Generic.List[string]]::new()
  $certificateCleanupSucceeded = $true

  try {
    if (Test-Path -LiteralPath $manifestPath) {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      $baseline = @($manifest.baselineThumbprints | ForEach-Object { [string]$_ })
      $imported = @($manifest.importedThumbprints | ForEach-Object { [string]$_ })
      if ($imported.Count -eq 0) {
        $imported = @(Get-StoreThumbprints | Where-Object { $_ -notin $baseline })
      }

      foreach ($thumbprint in $imported) {
        if ($thumbprint -notmatch "^[0-9A-F]{40,128}$") {
          throw "The signing cleanup manifest contains an invalid certificate thumbprint."
        }
        $storePath = Join-Path $certificateStore $thumbprint
        if (Test-Path -LiteralPath $storePath) {
          Remove-Item -LiteralPath $storePath -Force
        }
      }
    }
  } catch {
    $certificateCleanupSucceeded = $false
    $cleanupErrors.Add("Failed to remove imported certificate: $($_.Exception.Message)")
  }

  $cleanupPaths = @($certificatePath, $manifestTempPath, $configurationPath)
  if ($certificateCleanupSucceeded) {
    $cleanupPaths += $manifestPath
  }
  foreach ($path in $cleanupPaths) {
    try {
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
      }
    } catch {
      $cleanupErrors.Add("Failed to remove $path`: $($_.Exception.Message)")
    }
  }

  if ($certificateCleanupSucceeded) {
    try {
      if (Test-Path -LiteralPath $WorkDirectory) {
        Remove-Item -LiteralPath $WorkDirectory -Recurse -Force
      }
    } catch {
      $cleanupErrors.Add("Failed to remove signing directory: $($_.Exception.Message)")
    }
  }

  if ($cleanupErrors.Count -gt 0) {
    throw ($cleanupErrors -join [Environment]::NewLine)
  }
}

if ($Cleanup) {
  Remove-SigningMaterial
  return
}

if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE)) {
  throw "WINDOWS_CERTIFICATE is required."
}
if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_PASSWORD)) {
  throw "WINDOWS_CERTIFICATE_PASSWORD is required."
}
if ([string]::IsNullOrWhiteSpace($env:WINDOWS_TIMESTAMP_URL)) {
  throw "WINDOWS_TIMESTAMP_URL is required."
}
try {
  $timestampUri = [Uri]::new($env:WINDOWS_TIMESTAMP_URL, [UriKind]::Absolute)
} catch {
  throw "WINDOWS_TIMESTAMP_URL must be an absolute HTTPS URL."
}
if (
  $timestampUri.Scheme -ine "https" -or
  [string]::IsNullOrWhiteSpace($timestampUri.Host) -or
  ![string]::IsNullOrEmpty($timestampUri.UserInfo)
) {
  throw "WINDOWS_TIMESTAMP_URL must be an absolute HTTPS URL without embedded credentials."
}
Remove-SigningMaterial
New-Item -ItemType Directory -Path $WorkDirectory | Out-Null
$baselineThumbprints = Get-StoreThumbprints
Write-CleanupManifest -BaselineThumbprints $baselineThumbprints -ImportedThumbprints @()

$certificateBytes = $null
try {
  $certificateBytes = [Convert]::FromBase64String(($env:WINDOWS_CERTIFICATE -replace "\s", ""))
  [IO.File]::WriteAllBytes($certificatePath, $certificateBytes)

  $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
  $certificates = @()
  try {
    $certificates = @(Import-PfxCertificate `
      -FilePath $certificatePath `
      -CertStoreLocation $certificateStore `
      -Password $password)
  } finally {
    $importedThumbprints = @(
      Get-StoreThumbprints | Where-Object { $_ -notin $baselineThumbprints }
    )
    Write-CleanupManifest `
      -BaselineThumbprints $baselineThumbprints `
      -ImportedThumbprints $importedThumbprints
  }

  $signingCertificates = @($certificates | Where-Object { $_.HasPrivateKey })
  if ($signingCertificates.Count -ne 1) {
    throw "The PFX must contain exactly one signing certificate with a private key."
  }
  $certificate = $signingCertificates[0]
  if ([string]::IsNullOrWhiteSpace($certificate.Thumbprint)) {
    throw "The Windows signing certificate could not be imported."
  }

  @{
    bundle = @{
      windows = @{
        allowDowngrades = $false
        certificateThumbprint = $certificate.Thumbprint
        digestAlgorithm = "sha256"
        timestampUrl = $env:WINDOWS_TIMESTAMP_URL
        tsp = $true
      }
    }
  } |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $configurationPath -Encoding utf8
} finally {
  if (Test-Path -LiteralPath $certificatePath) {
    Remove-Item -LiteralPath $certificatePath -Force
  }
  if ($null -ne $certificateBytes) {
    [Array]::Clear($certificateBytes, 0, $certificateBytes.Length)
  }
}
