[CmdletBinding()]
param(
    [string]$Stage = (Join-Path ([IO.Path]::GetTempPath()) 'MokujiWebFiction1118'),
    [string]$Live = 'D:\Users\Documents\ChatGPT\Snipaste\app package\Duji-Local',
    [string]$Manifest = (Join-Path $PSScriptRoot 'runtime.txt'),
    [string]$Node = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$Stage = (Resolve-Path -LiteralPath $Stage).Path
$Live = (Resolve-Path -LiteralPath $Live).Path
if ($Stage -eq $Live) { throw 'Staging and installation directories must be different.' }
if (-not $Node) {
    $runtime = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($runtime) { $Node = $runtime.Source } else { $Node = 'D:\APP\nodejs\node.exe' }
}
$Node = (Resolve-Path -LiteralPath $Node).Path
if ([int](& $Node -p "process.versions.node.split('.')[0]") -lt 24) { throw 'Mokuji requires Node.js 24 or newer.' }
$baseUrl = 'http://127.0.0.1:5198'
$programBackup = Join-Path ([IO.Path]::GetTempPath()) ('MokujiBeforeUpgrade-' + [guid]::NewGuid().ToString('N'))
$readerFingerprint = @'
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const db = new DatabaseSync(process.argv[1], {readOnly:true});
const hash = createHash('sha256');
db.exec('BEGIN');
try {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  for (const name of ['reader_bindings','reader_progress','reader_uploads','reader_chapters','reader_kodo_text','reader_wiki_pages','reader_epub_images','reader_epub_media']) {
    hash.update(name);
    if (!exists.get(name)) continue;
    for (const row of db.prepare('SELECT * FROM '+name+' ORDER BY rowid').iterate()) {
      for (const value of Object.values(row)) {
        const bytes = ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          : Buffer.from(JSON.stringify(value));
        hash.update(String(bytes.byteLength)+':');
        hash.update(bytes);
      }
      hash.update('\n');
    }
  }
} finally { db.exec('ROLLBACK'); db.close(); }
console.log(hash.digest('hex'));
'@
function Get-ReaderFingerprint {
    $db = Join-Path $Live 'data\reader.sqlite'
    $result = & $Node --disable-warning=ExperimentalWarning -e $readerFingerprint $db
    if ($LASTEXITCODE -ne 0 -or $result -notmatch '^[0-9a-f]{64}$') { throw 'Could not read existing TXT and progress records.' }
    return $result
}
function Invoke-Launcher([string]$Mode) {
    & $Node --preserve-symlinks --input-type=module -e "import('node:url').then(u=>import(u.pathToFileURL(process.argv[1])))" (Join-Path $Live 'launcher.mjs') $Mode | Out-Host
    if ($LASTEXITCODE -ne 0) { throw ('Launcher failed with exit code ' + $LASTEXITCODE) }
}
function Get-HttpDigest([string]$Url) {
    $stream = (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15).RawContentStream
    try { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) }
    finally { $stream.Dispose() }
}
function Get-SafeChild([string]$Root, [string]$Name) {
    if ($Name -match '[:\\\x00-\x1f]' -or $Name -match '(^/|//|(?:^|/)\.\.?(?:/|$))') { throw "Invalid release path $Name" }
    $path = [IO.Path]::GetFullPath((Join-Path $Root $Name))
    if (-not $path.StartsWith(($Root.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path outside release directory: $Name"
    }
    $cursor = $path
    while ($cursor -ne $Root) {
        if ([IO.File]::Exists($cursor) -or [IO.Directory]::Exists($cursor)) {
            if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked release path: $Name" }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $path
}
function Copy-ReleaseFile([string]$SourcePath, [string]$DestinationPath) {
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($DestinationPath))
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}
$names = @(Get-Content -LiteralPath $Manifest -Encoding utf8 | Where-Object { $_ })
if ($names.Count -eq 0 -or $names.Count -ne @($names | Sort-Object -Unique).Count) { throw 'Invalid release inventory.' }
foreach ($must in @('launcher.mjs','web/index.html','web-fiction.mjs','epub-storage.mjs','epub-reader.cjs','epub-deps.cjs','Start-Mokuji.cmd','Stop-Mokuji.cmd','server-deploy/README.md')) {
    if ($names -notcontains $must) { throw "Incomplete release inventory: $must" }
}
$files = foreach ($name in ($names | Sort-Object { if ($_ -eq 'web/index.html') { 1 } else { 0 } })) {
    $parts = $name.Split('/')
    if ($parts.Count -eq 1) {
        if ($name -notmatch '^(?:[a-z][a-z0-9-]*\.(?:mjs|cjs)|(?:Start|Stop)-Mokuji\.cmd|Create-Desktop-Shortcut\.cmd|使用说明\.txt)$') { throw "Unexpected root file: $name" }
    } elseif ($parts[0] -notin @('web','client-source','server-deploy')) { throw "Unexpected program directory: $name" }
    if ($name -match '(?:^|/)(?:data|node_modules|\.git|\.env|dist|coverage|output|test-results)(?:/|$)' -or $name -match '\.(sqlite|pem|key|bak|log)(?:$|/)') {
        throw "Private entry in release inventory: $name"
    }
    $sourceFile = Get-SafeChild $Stage $name
    $destinationFile = Get-SafeChild $Live $name
    if (-not [IO.File]::Exists($sourceFile)) { throw "Missing staged file: $name" }
    if ([IO.Directory]::Exists($destinationFile)) { throw "Destination is a directory: $name" }
    [pscustomobject]@{Name=$name; Source=$sourceFile; Destination=$destinationFile; Backup=(Join-Path $programBackup $name); Existed=[IO.File]::Exists($destinationFile)}
}
$lock = [Threading.Mutex]::new($false, 'Local\MokujiLocal5198ProgramUpdate')
$locked = $false
try {
    try { $locked = $lock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'A program update is already in progress.' }
    # The launcher confirms the identity on port 5198 and starts a stopped installation.
    Invoke-Launcher '--no-open'
    $beforeLibrary = Get-HttpDigest ($baseUrl + '/api/library')
    $beforeReader = Get-ReaderFingerprint
    $beforeMode = Invoke-RestMethod ($baseUrl + '/api/connection-mode') -TimeoutSec 10
    $null = [IO.Directory]::CreateDirectory($programBackup)
    foreach ($file in $files) {
        if ($file.Existed) { Copy-ReleaseFile $file.Destination $file.Backup }
    }
    $applied = [Collections.Generic.List[object]]::new()
    Invoke-Launcher '--stop'
    try {
        foreach ($file in $files) {
            $applied.Add($file)
            Copy-ReleaseFile $file.Source $file.Destination
        }
        Invoke-Launcher '--no-open'
        $status = Invoke-RestMethod ($baseUrl + '/api/local-status') -TimeoutSec 10
        $mode = Invoke-RestMethod ($baseUrl + '/api/connection-mode') -TimeoutSec 10
        $fiction = Invoke-RestMethod ($baseUrl + '/api/reader/web-fiction') -TimeoutSec 25
        $books = Invoke-RestMethod ($baseUrl + '/api/reader/books') -TimeoutSec 25
        $chapter = Invoke-RestMethod ($baseUrl + '/api/reader/chapter?id=open%3Axiyou&n=0') -TimeoutSec 25
        if ($status.app -ne 'duji-local' -or $mode.mode -ne $beforeMode.mode -or $mode.txtStorage -ne $beforeMode.txtStorage) { throw 'Application identity or storage mode changed.' }
        if ($fiction.catalogTotal -lt 5358 -or $fiction.total -lt 1 -or $fiction.totalReadable -lt 1 -or $fiction.totalOfficial -lt 1 -or @($fiction.results).Count -lt 1) { throw 'Expanded web-fiction catalog is unavailable.' }
        if (@($books.books).Count -lt 1 -or @($chapter.paragraphs).Count -lt 2) { throw 'Reader checks failed.' }
        if ((Get-HttpDigest ($baseUrl + '/api/library')) -ne $beforeLibrary -or (Get-ReaderFingerprint) -ne $beforeReader) { throw 'Existing library, imported TXT, bindings or bookmarks changed.' }
        if ((Get-HttpDigest $baseUrl) -ne (Get-FileHash -LiteralPath (Join-Path $Stage 'web/index.html')).Hash) { throw 'Live frontend differs from the staged version.' }
    } catch {
        $updateError = $_.Exception.Message
        try {
            Invoke-Launcher '--stop'
            foreach ($file in $applied) {
                if ($file.Existed) { Copy-ReleaseFile $file.Backup $file.Destination }
                elseif ([IO.File]::Exists($file.Destination)) { Remove-Item -LiteralPath $file.Destination -Force }
            }
            Invoke-Launcher '--no-open'
        } catch { throw "Update failed: $updateError. Recovery failed: $($_.Exception.Message). Backup: $programBackup" }
        throw "Restored previous application files following failed validation: $updateError"
    }
    [pscustomobject]@{
        app=$status.app; catalogTotal=$fiction.catalogTotal; readable=$fiction.totalReadable; official=$fiction.totalOfficial
        existingReaderVerified=$true; webVerified=$true; programBackup=$programBackup
    } | ConvertTo-Json -Compress
} finally {
    if ($locked) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
