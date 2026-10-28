<#
.SYNOPSIS
Installs the architect workflow for one self-hosted model into OpenCode's config directory.

.DESCRIPTION
Replaces the OpenCode config directory with this bundle: head-architect,
architect, developer and reviewer, all on the one model you point it at. The existing directory is backed up first. Sessions, credentials
and other data in OpenCode's data directory are not touched.

On a reinstall, -BaseUrl, -Model, -ContextTokens and -OutputTokens default to
the values in the config being replaced, so an update needs no arguments.

.EXAMPLE
.\install.ps1 -BaseUrl https://llm.example.internal/v1 -Model my-model -ContextTokens 131072

.EXAMPLE
.\install.ps1
Updates an earlier install and keeps its model settings.
#>
param(
  [string]$BaseUrl,
  [string]$Model,
  [int]$ContextTokens,
  [int]$OutputTokens,
  [string]$ConfigDir = (Join-Path $HOME '.config\opencode')
)

$ErrorActionPreference = 'Stop'
$bundle = $PSScriptRoot
$configFile = Join-Path $ConfigDir 'opencode.json'

# Settings from the config being replaced, so an update keeps its model.
$previous = $null
if (Test-Path $configFile) {
  try {
    $old = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($old.provider.work) {
      $previous = @{
        BaseUrl       = $old.provider.work.options.baseURL
        Model         = $old.provider.work.models.main.id
        ContextTokens = $old.provider.work.models.main.limit.context
        OutputTokens  = $old.provider.work.models.main.limit.output
      }
    }
  } catch {
    Write-Warning "Could not read the existing $configFile; its settings are not reused."
  }
}

# -Encoding UTF8 on every read: Windows PowerShell 5.1 reads files without a
# byte-order mark as ANSI, which garbles non-ASCII text such as the provider name.
$template = Get-Content (Join-Path $bundle 'opencode.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$main = $template.provider.work.models.main
function Pick($given, $key, $default) {
  if ($given) { return $given }
  if ($previous -and $previous[$key]) { return $previous[$key] }
  return $default
}
$BaseUrl = Pick $BaseUrl 'BaseUrl' $null
$Model = Pick $Model 'Model' $null
$ContextTokens = Pick $ContextTokens 'ContextTokens' $main.limit.context
$OutputTokens = Pick $OutputTokens 'OutputTokens' $main.limit.output
if (-not $BaseUrl -or -not $Model) {
  throw 'No earlier install to update: pass -BaseUrl (the server''s OpenAI-compatible /v1 URL) and -Model (the model id it serves).'
}

$template.provider.work.options.baseURL = $BaseUrl
$main.id = $Model
$main.limit.context = [int]$ContextTokens
$main.limit.output = [int]$OutputTokens

if (Test-Path $ConfigDir) {
  $backup = '{0}.backup-{1}' -f $ConfigDir, (Get-Date -Format 'yyyyMMdd-HHmmss')
  Move-Item $ConfigDir $backup
  Write-Host "Previous config moved to $backup"
}
New-Item -ItemType Directory -Force $ConfigDir | Out-Null
foreach ($item in 'prompts', 'skills', 'plugins', 'lib', 'context-hygiene.json', 'VERSION') {
  Copy-Item (Join-Path $bundle $item) $ConfigDir -Recurse
}

# Windows PowerShell 5.1 writes a byte-order mark with -Encoding UTF8, which
# OpenCode's JSON parser does not expect, so write UTF-8 without one.
$json = $template | ConvertTo-Json -Depth 32
[IO.File]::WriteAllText($configFile, $json, (New-Object Text.UTF8Encoding $false))

Write-Host "Installed $(Get-Content (Join-Path $bundle 'VERSION')) to $ConfigDir"
Write-Host "Model: $Model at $BaseUrl (context $ContextTokens, output $OutputTokens)"
if (-not $env:WORK_LLM_API_KEY) {
  Write-Host 'WORK_LLM_API_KEY is not set. If the model server needs a key, set it as a user environment variable and restart the terminal.'
}
