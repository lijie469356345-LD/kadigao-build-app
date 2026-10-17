$updateDir = "$PSScriptRoot\updates"
$port = 9000

if (-not (Test-Path $updateDir)) {
    Write-Host '[ERROR] updates folder not found. Run Build-Update first.'
    Read-Host -Prompt 'Press Enter to exit'
    exit 1
}

Write-Host '================================================'
Write-Host '  Update Server'
Write-Host "  Port: $port"
Write-Host "  Dir:  $updateDir"
Write-Host '  Press Ctrl+C to stop'
Write-Host '================================================'

$nodeExe = "$PSScriptRoot\node.exe"
$serverJs = @'
const http = require('http');
const fs = require('fs');
const path = require('path');
const dir = process.env.UPDATE_DIR;

const mime = {
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.html': 'text/html',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const filePath = path.join(dir, req.url === '/' ? 'version.json' : req.url);
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
  fs.createReadStream(filePath)
    .on('error', () => {
      res.writeHead(404);
      res.end('Not Found');
    })
    .pipe(res);
});

server.listen(parseInt(process.env.UPDATE_PORT), '0.0.0.0', () => {
  console.log('Update server running: http://0.0.0.0:' + process.env.UPDATE_PORT);
});
'@

$serverFile = "$env:TEMP\update_server.js"
[System.IO.File]::WriteAllText($serverFile, $serverJs, (New-Object System.Text.UTF8Encoding $false))

$env:UPDATE_DIR = $updateDir
$env:UPDATE_PORT = "$port"

& $nodeExe $serverFile
