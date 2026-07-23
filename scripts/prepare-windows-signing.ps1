$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE)) {
  throw "WINDOWS_CERTIFICATE is required."
}
if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CERTIFICATE_PASSWORD)) {
  throw "WINDOWS_CERTIFICATE_PASSWORD is required."
}
if ([string]::IsNullOrWhiteSpace($env:WINDOWS_TIMESTAMP_URL)) {
  throw "WINDOWS_TIMESTAMP_URL is required."
}

$certificatePath = Join-Path $env:RUNNER_TEMP "tarab-release-certificate.pfx"
$certificateBytes = [Convert]::FromBase64String(($env:WINDOWS_CERTIFICATE -replace "\s", ""))
[IO.File]::WriteAllBytes($certificatePath, $certificateBytes)

$password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
$certificate = Import-PfxCertificate `
  -FilePath $certificatePath `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -Password $password
Remove-Item $certificatePath -Force

if ($null -eq $certificate -or [string]::IsNullOrWhiteSpace($certificate.Thumbprint)) {
  throw "The Windows signing certificate could not be imported."
}

$configuration = @{
  bundle = @{
    windows = @{
      allowDowngrades = $false
      certificateThumbprint = $certificate.Thumbprint
      digestAlgorithm = "sha256"
      timestampUrl = $env:WINDOWS_TIMESTAMP_URL
      tsp = $true
    }
  }
}

$configuration |
  ConvertTo-Json -Depth 5 |
  Set-Content "src-tauri/tauri.windows-signing.json" -Encoding utf8
