<#
.SYNOPSIS
Installs the architect workflow for one self-hosted model into OpenCode's config directory.

.DESCRIPTION
Replaces the OpenCode config directory with this bundle: head-architect,
architect, developer and reviewer, all on the one model you point it at.
The existing directory is backed up first. Sessions, credentials (auth.json)
and other data in OpenCode's data directory are not touched.

-Provider is the provider id. If the server needs a key, it is the id the key
is stored under in auth.json (opencode auth login).

On a reinstall, -Provider, -Model and -BaseUrl default to the values in the
config being replaced, so an update needs no arguments.

.EXAMPLE
.\install.ps1 -Provider work -Model my-model -BaseUrl https://llm.example.internal/v1

.EXAMPLE
.\install.ps1
Updates an earlier install and keeps its provider and model.
#>
param(
  [string]$Provider,
  [string]$Model,
  [string]$BaseUrl,
  [string]$ConfigDir = (Join-Path $HOME '.config\opencode')
)

$ErrorActionPreference = 'Stop'
$bundle = $PSScriptRoot
$configFile = Join-Path $ConfigDir 'opencode.json'

# -Encoding UTF8 on every read: Windows PowerShell 5.1 reads files without a
# byte-order mark as ANSI, which garbles non-ASCII text.

# Settings from the config being replaced, so an update keeps its model.
if (Test-Path $configFile) {
  try {
    $old = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $oldProvider, $oldModel = $old.model -split '/', 2
    $oldEntry = $old.provider.$oldProvider
    if ($oldEntry) {
      # Installs before this format named the model "main" and kept the
      # server's model id in its "id" field.
      $oldId = $oldEntry.models.$oldModel.id
      if (-not $Provider) { $Provider = $oldProvider }
      if (-not $Model) { $Model = $(if ($oldId) { $oldId } else { $oldModel }) }
      if (-not $BaseUrl) { $BaseUrl = $oldEntry.options.baseURL }
    }
  } catch {
    Write-Warning "Could not read the existing $configFile; its settings are not reused."
  }
}
if (-not $Provider -or -not $Model -or -not $BaseUrl) {
  throw 'No earlier install to update: pass -Provider (the provider id), -Model (the model id the server serves) and -BaseUrl (the server''s OpenAI-compatible /v1 URL).'
}

# Fill the template as text, so opencode.json keeps the bundle's formatting.
function JsonText($value) { $value.Replace('\', '\\').Replace('"', '\"') }
$json = Get-Content (Join-Path $bundle 'opencode.json') -Raw -Encoding UTF8
$json = $json.Replace('<PROVIDER>', (JsonText $Provider))
$json = $json.Replace('<MODEL_NAME>', (JsonText $Model))
$json = $json.Replace('<WORK_URL>', (JsonText $BaseUrl))
$json | ConvertFrom-Json | Out-Null

if (Test-Path $ConfigDir) {
  $backup = '{0}.backup-{1}' -f $ConfigDir, (Get-Date -Format 'yyyyMMdd-HHmmss')
  Move-Item $ConfigDir $backup
  Write-Host "Previous config moved to $backup"
}
New-Item -ItemType Directory -Force $ConfigDir | Out-Null
foreach ($item in 'prompts', 'skills', 'plugins', 'lib', 'context-hygiene.json', 'VERSION') {
  Copy-Item (Join-Path $bundle $item) $ConfigDir -Recurse
}

# Write UTF-8 without a byte-order mark, which OpenCode's JSON parser does not
# expect and Windows PowerShell 5.1 would add with -Encoding UTF8.
[IO.File]::WriteAllText($configFile, $json, (New-Object Text.UTF8Encoding $false))

Write-Host "Installed $(Get-Content (Join-Path $bundle 'VERSION')) to $ConfigDir"
Write-Host "Model: $Provider/$Model at $BaseUrl"
