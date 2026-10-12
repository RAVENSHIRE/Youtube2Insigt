$ErrorActionPreference = 'Stop'
$PreviousOutputEncoding = $OutputEncoding
$ProbeInput = $null
$AccountCredential = $null
$ProbeExit = 1
try {
    $VideoUrl = Read-Host 'Andere YouTube-Video-URL (noch nicht in deiner Bibliothek)'
    $AccountCredential = Get-Credential -Message 'Bestehendes verifiziertes Free-Testkonto auf localhost:3000'
    if ($null -eq $AccountCredential) { throw 'Anmeldung abgebrochen.' }
    $ProbeInput = @{
        base = 'http://localhost:3000'
        videoUrl = $VideoUrl
        email = $AccountCredential.UserName
        password = $AccountCredential.GetNetworkCredential().Password
    } | ConvertTo-Json -Compress
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $ProbeInput | & node (Join-Path $PSScriptRoot 'verify-free-analysis.js') --consume-credit
    $ProbeExit = $LASTEXITCODE
}
finally {
    $ProbeInput = $null
    $AccountCredential = $null
    $OutputEncoding = $PreviousOutputEncoding
}
if ($ProbeExit -ne 0) {
    throw 'Kein erfolgreicher Live-Nachweis. Ergebnis und passenden [analysis]-Serverlog prüfen.'
}
