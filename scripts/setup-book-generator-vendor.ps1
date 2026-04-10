$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$requirementsPath = Join-Path $repoRoot "book_generator\requirements.txt"
$vendorPath = Join-Path $repoRoot "book_generator\vendor"

if (!(Test-Path $requirementsPath)) {
  throw "requirements file not found: $requirementsPath"
}

if (!(Test-Path $vendorPath)) {
  New-Item -ItemType Directory -Path $vendorPath | Out-Null
}

function Resolve-PythonCommand {
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return @{ Exe = "python"; Prefix = @() }
  }
  if (Get-Command py -ErrorAction SilentlyContinue) {
    return @{ Exe = "py"; Prefix = @("-3") }
  }
  throw "Python runtime not found. Install Python and ensure `python` or `py` is available."
}

$python = Resolve-PythonCommand

Write-Host "Installing Python packages into $vendorPath"
& $python.Exe @($python.Prefix + @("-m", "pip", "install", "--upgrade", "pip"))
& $python.Exe @($python.Prefix + @("-m", "pip", "install", "--target", $vendorPath, "-r", $requirementsPath))

Write-Host "book_generator/vendor is ready."

