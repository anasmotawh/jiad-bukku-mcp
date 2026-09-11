param([switch]$Rotate, [switch]$Copy)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$tokenPath = Join-Path (Get-Location) '.mcp-token.dpapi'
if ($Rotate -and $Copy) { throw 'Use Rotate and Copy separately.' }
if ($Rotate) {
  $token = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $tokenPath
  $token | node node_modules/wrangler/bin/wrangler.js secret put MCP_AUTH_TOKEN --name jiad-bukku-mcp
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed; the encrypted candidate is retained locally.' }
} else {
  if (!(Test-Path $tokenPath)) { throw 'No local encrypted token. Use -Rotate to provision and verify a new one.' }
  $secure = Get-Content $tokenPath | ConvertTo-SecureString
  $token = [System.Net.NetworkCredential]::new('', $secure).Password
}
if ($Copy) {
  Set-Clipboard -Value $token
  Write-Output 'Token copied to clipboard without displaying it.'
} else {
  $token | node scripts/verify-mcp.mjs
  if ($LASTEXITCODE -ne 0) { throw 'MCP verification failed.' }
}
