$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\modules\chargen1547_v2")
$stage = "c:\temp\CharacterCreator\_zip_stage_flat"
$zip = "c:\temp\CharacterCreator\chargen1547_v2.zip"

$excludeDirs = @(
    "foundry examples"
)

if (Test-Path $stage) {
    Remove-Item $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

Get-ChildItem $root | ForEach-Object {
    if ($excludeDirs -contains $_.Name) {
        return
    }

    $destination = Join-Path $stage $_.Name
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName $destination -Recurse
    } else {
        Copy-Item $_.FullName $destination
    }
}

if (Test-Path $zip) {
    Remove-Item $zip -Force
}

Compress-Archive -Path "$stage\*" -DestinationPath $zip
Write-Output "Built $zip"
