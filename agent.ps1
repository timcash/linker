param(
  [switch]$Once,
  [int]$Slice,
  [switch]$Resume,
  [switch]$StaticOnly,
  [switch]$Browser,
  [switch]$InPlace,
  [switch]$Worktree,
  [switch]$ReviewOnly,
  [int]$MaxIterations,
  [switch]$PromoteAccepted,
  [string]$PromoteRun,
  [switch]$UseWsl
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $Root 'scripts\agent-loop\run.ts'
$PromoteRunner = Join-Path $Root 'scripts\agent-loop\promote-run.ts'

if (-not (Test-Path $Runner)) {
  throw "Missing agent loop runner at $Runner"
}

if ($PromoteRun) {
  if (-not (Test-Path $PromoteRunner)) {
    throw "Missing agent loop promote runner at $PromoteRunner"
  }

  Push-Location $Root
  try {
    & node --import tsx $PromoteRunner $PromoteRun
  }
  finally {
    Pop-Location
  }
  exit $LASTEXITCODE
}

$NodeArgs = @('--import', 'tsx', $Runner)

if ($Once) {
  $NodeArgs += '--once'
}

if ($PromoteAccepted) {
  $NodeArgs += '--promote-accepted'
}

if ($PSBoundParameters.ContainsKey('Slice')) {
  $NodeArgs += '--slice'
  $NodeArgs += $Slice.ToString()
}

if ($Resume) {
  $NodeArgs += '--resume'
}

if ($Browser) {
  $NodeArgs += '--browser'
}
elseif ($StaticOnly -or -not $Browser) {
  $NodeArgs += '--static-only'
}

if ($InPlace) {
  $NodeArgs += '--in-place'
}

if ($Worktree) {
  $NodeArgs += '--worktree'
}

if ($ReviewOnly) {
  $NodeArgs += '--review-only'
}

if ($PSBoundParameters.ContainsKey('MaxIterations')) {
  $NodeArgs += '--max-iterations'
  $NodeArgs += $MaxIterations.ToString()
}

function Test-WslAgentSupport {
  try {
    $null = & wsl.exe bash -lc "test -x /usr/local/bin/codex && test -x /usr/local/bin/tsx"
    return $LASTEXITCODE -eq 0
  }
  catch {
    return $false
  }
}

function Convert-ToWslPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WindowsPath
  )

  if ($WindowsPath -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
    $drive = $Matches['drive'].ToLowerInvariant()
    $rest = ($Matches['rest'] -replace '\\', '/')
    return "/mnt/$drive/$rest"
  }

  throw "Failed to convert Windows path to WSL path: $WindowsPath"
}

function Convert-ToSingleQuotedBashLiteral {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $Replacement = "'" + [char]34 + "'" + [char]34 + "'"
  return "'" + ($Value -replace "'", $Replacement) + "'"
}

$shouldUseWsl = $UseWsl.IsPresent

if ($shouldUseWsl) {
  if (-not (Test-WslAgentSupport)) {
    throw 'WSL Codex support is not ready. Install Linux codex and tsx first, or run without -UseWsl.'
  }

  $WslRoot = Convert-ToWslPath -WindowsPath $Root
  $BashParts = @(
    "cd $(Convert-ToSingleQuotedBashLiteral -Value $WslRoot) &&"
    "/usr/local/bin/tsx scripts/agent-loop/run.ts"
  )

  if ($NodeArgs.Length -gt 3) {
    foreach ($Arg in $NodeArgs[3..($NodeArgs.Length - 1)]) {
      $BashParts += Convert-ToSingleQuotedBashLiteral -Value $Arg
    }
  }

  $BashCommand = ($BashParts -join ' ')
  & wsl.exe bash -lc $BashCommand
  exit $LASTEXITCODE
}

Push-Location $Root
try {
  & node @NodeArgs
}
finally {
  Pop-Location
}
