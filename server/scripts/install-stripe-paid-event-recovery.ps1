param(
    [string]$ProjectRoot = "$env:USERPROFILE\Desktop\dev\Youtube2Insigt",
    [Parameter(Mandatory=$true)][string]$EventId,
    [string]$PatchPath = (Join-Path $PSScriptRoot 'stripe-paid-event-recovery.patch')
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $ProjectRoot
if (-not (Test-Path -LiteralPath '.\server\accounts\billing.js')) { throw 'Projektordner stimmt nicht.' }
if (-not (Test-Path -LiteralPath $PatchPath)) { throw 'stripe-paid-event-recovery.patch ebenfalls in denselben Downloadordner speichern.' }
$ExpectedHash = 'eb45d26eb23505ba6210990e82f675e80ceaa8443522ffb115f2d63ad4af37c1'
if ((Get-FileHash -LiteralPath $PatchPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'Patch-Pruefsumme stimmt nicht.' }
# No branch switch, reset, stash, secret output, or automated process termination.
$Excludes = @()
$ExistingHelpers = @{
    'server/scripts/diagnose-stripe-checkout.cjs' = 'fe8a3cb6fa9d7560649585cb22bb486ec23dfc94b3894ca990c8daa1c0d38b85'
    'server/test/stripeCheckoutDiagnosis.test.js' = 'c9184c22c5700298abfe71a5f46a304f280e68240b4df9f951c55dc0b535c046'
}
foreach ($HelperPath in $ExistingHelpers.Keys) {
    if (Test-Path -LiteralPath $HelperPath) {
        $Normalized = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $HelperPath).Path).Replace("`r`n", "`n")
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try { $Digest = [BitConverter]::ToString($Hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Normalized))).Replace('-', '').ToLowerInvariant() }
        finally { $Hasher.Dispose() }
        if ($Digest -ne $ExistingHelpers[$HelperPath]) { throw "Vorhandene Datei weicht ab: $HelperPath. Nichts ueberschreiben." }
        $Excludes += "--exclude=$HelperPath"
    }
}
$CheckArgs = @('apply', '--check') + $Excludes + @($PatchPath)
$ErrorActionPreference = 'Continue'
try { & git @CheckArgs 2>&1 | Out-Host; $CheckExit = $LASTEXITCODE } finally { $ErrorActionPreference = 'Stop' }
if ($CheckExit -ne 0) {
    $ReverseArgs = @('apply', '--reverse', '--check') + $Excludes + @($PatchPath)
    $ErrorActionPreference = 'Continue'
    try { & git @ReverseArgs 2>&1 | Out-Host; $ReverseExit = $LASTEXITCODE } finally { $ErrorActionPreference = 'Stop' }
    if ($ReverseExit -ne 0) { throw 'Patch passt nicht zum lokalen Stand. Keine Dateien veraendert.' }
    Write-Host 'Recovery-Patch ist bereits vorhanden.'
} else {
    $Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
    $CodeBackup = Join-Path $ProjectRoot "server\runtime\recovery\stripe-code-$Stamp"
    New-Item -ItemType Directory -Path $CodeBackup | Out-Null
    Copy-Item -LiteralPath '.\server\accounts\billing.js' -Destination (Join-Path $CodeBackup 'billing.js')
    $ApplyArgs = @('apply') + $Excludes + @($PatchPath)
    & git @ApplyArgs
    if ($LASTEXITCODE -ne 0) { throw 'Patch konnte nicht angewendet werden. Recovery wurde nicht gestartet.' }
    Write-Host "Bisheriger Billing-Code gesichert: $CodeBackup"
}
& node --test .\server\test\stripePaidEventRecovery.test.js .\server\test\stripeCheckoutDiagnosis.test.js .\server\test\proCheckout.test.js
if ($LASTEXITCODE -ne 0) { throw 'Billing-Tests fehlgeschlagen. Datenbank nicht veraendert.' }
# The user has stopped the server; the recovery also checks its configured TCP port.
& node .\server\scripts\recover-stripe-paid-event.cjs $ProjectRoot $EventId --apply --server-stopped
if ($LASTEXITCODE -ne 0) { throw 'Recovery blockiert. Fehlercode oben pruefen; keine neue Zahlung starten.' }
Write-Host 'Jetzt node .\server\server.js starten und die Kontoseite aktualisieren.'
