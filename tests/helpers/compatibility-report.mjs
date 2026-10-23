export function summarize(routes) {
 const counts={total:routes.length,passed:0,failed:0,unsupported:0,untested:0};
 for(const route of routes) {
  if(!['passed','failed','unsupported','untested'].includes(route.status))throw new Error(`Invalid route status: ${route.status}`);
  counts[route.status]++;
 }
 const attempted=counts.passed+counts.failed;
 return {...counts,attempted,successRate:attempted?counts.passed/attempted:null,coverage:routes.length?attempted/routes.length:0,
  conversionMs:routes.reduce((sum,r)=>sum+(r.ms??0),0)};
}

export function matrix(reports) {
 const lines=['# Phase 8.1 — measured compatibility matrix','',
  'Generated from the same 134 fixture routes. WebKit is not shipping Safari; Chromium is not branded Chrome.',
  'passed = downloaded and validated; unsupported = inspect succeeded but output was not advertised; failed = inspection/conversion/assertion failed; untested = browser/setup unavailable.',
  'Success rate = passed / (passed + failed); coverage = attempted / 134. API presence does not guarantee codec or storage operation.','',
  '| Browser | Version | Passed | Unsupported | Failed | Untested | Success rate | Coverage | Conversion ms |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|'];
 for(const report of reports) {
  const s=summarize(report.routes);
  lines.push(`| ${report.browser} | ${report.version??'—'} | ${s.passed} | ${s.unsupported} | ${s.failed} | ${s.untested} | ${s.successRate===null?'—':(100*s.successRate).toFixed(1)+'%'} | ${(100*s.coverage).toFixed(1)}% | ${s.conversionMs.toFixed(0)} |`);
 }
 lines.push('','## Worker capabilities (presence, not operational guarantees)','',
  `| Capability | ${reports.map(r=>r.browser).join(' | ')} |`,`|---|${reports.map(()=>'---').join('|')}|`);
 for(const [label,key] of [['OffscreenCanvas','offscreenCanvas'],['ImageBitmap','imageBitmap'],['WebAssembly','wasm'],['AudioEncoder','audioEncoder'],['AudioDecoder','audioDecoder'],['OPFS API','opfs'],['Web Locks API','webLocks']]) {
  const cells=reports.map(r=>{
   const cap=r.browserCapabilities??r.analyses?.find(a=>a.analysis?.browserCapabilities)?.analysis.browserCapabilities;
   const value=cap?.[key]??cap?.environment?.[key];
   return value===undefined?'untested':value?'present':'absent';
  });
  lines.push(`| ${label} | ${cells.join(' | ')} |`);
 }
 lines.push('','## Browser-dependent constraints','',
  '| Paths | Constraint |','|---|---|',
  '| Images | Worker OffscreenCanvas + ImageBitmap required. JPEG/WebP/conditional AVIF depend on actual native encoding and verification; AVIF output is outside the baseline 134. |',
  '| AAC / M4A | Native WebCodecs codec/profile support required; no new WASM fallback. |',
  '| MP3 / FLAC / Vorbis / Opus | Existing local single-thread WASM; shared memory/isolation not required. |',
  '| ZIP / TAR.GZ / GZIP | Per-algorithm compression support required; ZIP can use existing stored-record fallback. |',
  '| Large output | Actual OPFS + Web Locks/storage access is conditional; Blob fallback is bounded at 64 MiB. Small-fixture success does not validate large-file storage. |',
  '| Safari / Chrome | Playwright WebKit/Chromium do not certify shipping Safari/iOS or branded Chrome. Missing engines remain untested. |');
 lines.push('','## Routes','',`| Input → Output | ${reports.map(r=>r.browser).join(' | ')} |`,`|---|${reports.map(()=>'---').join('|')}|`);
 for(let i=0;i<(reports[0]?.routes.length??0);i++)lines.push(`| ${reports[0].routes[i].input} → ${reports[0].routes[i].output} | ${reports.map(r=>r.routes[i].status).join(' | ')} |`);
 return lines.join('\n')+'\n';
}
