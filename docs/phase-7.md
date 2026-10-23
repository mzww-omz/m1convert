# Phase 7 — メモリ監査と大容量アーカイブの逐次変換

## 実装結果

**ブラウザ内のZIP/TAR/GZIP変換を、全量ArrayBuffer処理から範囲読み込み・逐次処理・OPFS出力へ変更した。** 96 MiBの実データを含むアーカイブを、旧64 MiB入力/展開/出力制限を超えて変換した。画像・音声の不要なコピーも削減。形式数・MorphSurface・既存の変換設定を変更せず、依存・WASM・通信先は追加していない。

単に上限を上げた実装ではない。全量デコードを必要とする画像/音声エンジンの上限は残す。画像のタイルデコード、長時間圧縮音声、動画のストリーミングを実装済みとはしない。

## 監査：どこにメモリが使われていたか

| 経路 | Phase 6まで | Phase 7 |
| --- | --- | --- |
| Worker入口 | 形式を判定する前に全ファイルを64 MiBで拒否 | 4 KiBのシグネチャーを読んでエンジンごとの予算へ分岐。アーカイブに全量bufferの上限を流用しない |
| TAR | 全encoded ArrayBufferと、そのsubarrayを保持。再パックした全量出力も保持 | 512-byte header、padding/end markerの範囲検査。本文はBlob sliceに対する64 KiB単位の読み込み。チェックサムのないTAR本文を解析時に無駄に全走査しない |
| ZIP | 全入力 + deflate展開chunks + 連結した全entry + 全packed出力 + 最終連結出力 | 末尾最大65,557 bytes、central/local headerと名前をrange-read。entryは再生成可能なstream。CRCを逐次計算し、宣言サイズを超えたら停止 |
| GZIP/TAR.GZ | 全入力と展開chunksを保持し、さらに連結。TAR.GZ出力は全TARも先に構築 | Native DecompressionStream → backpressured sink。seekが必要な展開データだけ一時OPFSへspool。TAR header/data/paddingを逐次圧縮 |
| 出力 | Uint8Array → 明示的slice → Blob snapshot。検証時に全量再読み込み | OPFS writerへ1chunkずつawait write。閉じたFile/Blobの参照を返す。検証もstream比較。Blob fallbackでも最終の巨大Uint8Array連結を作らない |
| GZIP出力検証 | 全量展開bufferと元entryを比較 | DecompressionStreamと元entry streamを直接byte比較。大きな検証spoolさえ不要 |
| BMP/TIFF/ICO/SVG | 構造検査後、同じFileをデコーダーで再度全量読み込み。ICO出力検証で各frameのたびに読む | `readImage`が検査済みbytesとinfoを返し、デコードと各frame検証で同じbytesを再利用 |
| 音声 | encode結果のsliceを作ってからBlob/File化。interleaved encode frameもslice | Blob自身がsnapshotするので前段sliceを除去。変更されないPCM frameはsubarrayを渡す |
| PCM/libav/native AAC | 元File、encoded input、Float32 PCM、場合によりリサンプル先PCM、encoder/decoderの内部資源 | 依然として全PCM保持。コピー削減だけを行い、streaming対応とはしない |

アーカイブの旧buffered helperは音声batch ZIPや独立テストでまだ使用するため残した。実アーカイブadapterは遅延importで新しいstream実装を選ぶ。大きな汎用フレームワークや新codecは導入しない。

## 処理経路と能力選択

```text
File / Blob（元データを変更しない）
 → range-read metadata + 既存の安全なpath/USTARルール
 → lazy entry.open(): ReadableStream
 → native gzip / deflate-raw、またはそのまま逐次再パック
 → await sink.write(chunk)（backpressure）
 → 出力構造の再解析 + 元streamとの全byte比較
 → 検証済みのdisk-backed Blob / bounded Blob
 → 明示的なDownload
```

- ZIP inputはStore/Deflate、CRC、descriptor、local/central一致、record重複/空隙を検査。ZIP outputはdata descriptor付きの正規ZIP32。streamingのためdescriptorが追加されるが、拡張子変更や偽装ではない。
- TARは従来と同じPOSIX USTAR。links/devices/extensions、unsafe path、重複/Unicode・大文字小文字collision、padding/end marker異常は拒否する。
- gzip/deflateは各APIを実照会する。利用できなければ対応経路を非表示、ZIPは従来同様に実Storeへ切り替える。これは圧縮方式の違いであり、ファイル本文の劣化ではない。
- OPFSが使えるWorkerでは逐次書き込み。API不在/NotSupported/SecurityErrorなら64 MiBのbounded Blobへ代替。quota/I/O failureでは全量RAMへ無理なretryをせず、回復方法のあるエラーにする。
- OPFSなしでも、**65 MiBのゼロ本文TAR → GZIP**は小さな圧縮出力とstream検証だけで成功する。入力サイズだけで一律拒否しない例である。一方、大きなGZIP入力/TAR.GZのseek用spoolが64 MiBを超える場合はOPFSが必要。
- 各entryのopenを再実行できるため、入力展開と出力検証を同時に全保持しない。ZIPは一度に1 entryを処理し、出力central directoryに必要なmetadataだけを保持する。
- 同一streamに大量のread/write Promiseを投げない。本文rangeは64 KiB、compression queueやstream readerは標準のbackpressureに従う。Native圧縮内部のメモリ量を64 KiBだと主張するものではない。

## 保存、所有権、Cancelとプライバシー

**OPFSは同一originのブラウザ管理領域。サーバーへのアップロードや、許可なしの任意フォルダー保存ではない。** ただし展開されたファイル内容も一時的にブラウザstorageへ書かれ得る。以前の「browser storageに書かない」という説明は変更した。UIにも一時browser storageの利用を示す。

- `stream-output.ts`: OPFS writer、bounded Blob fallback、quota、出力計数、削除とcross-tab leaseを管理。
- Workerは一時ファイル名をhostへ通知し、hostが作成を完了してからACKする。Workerは既存handleを開くだけ。**Cancelと非同期ファイル作成が競合しても、hostが未完了の作成を待って削除する**ため、削除後に遅れてファイルが出現するraceを避ける。
- 各ジョブの成功時は中間ファイルを削除し、完成出力1個だけ保持。Cancel/error/timeoutはWorker terminate後に全jobファイルを削除。書き込み中止を通常例外のfinallyだけに依存しない。
- 完成出力はResultManagerが所有。clear/Convert Again/新しい入力/reset/destroyでURLをrevokeし、OPFSファイルを削除。stale結果やURL allocation failureでも破棄する。削除は非同期で、schedulerの失敗経路では完了を待つ。再試行は新Worker。
- Web Locksが利用可能なら、各一時ファイルはmain threadのleaseで保護し、Worker終了後もDownloadが有効な間は保持する。次のdisk jobで24時間以上古い**unleased** Convert所有ファイルだけを回収する。別tabの生きた出力/ジョブや、名前の異なるファイルは削除しない。
- OS/browserの強制終了、reload、storage権限喪失時にJavaScript cleanupの実行は保証できない。一時データが残る可能性がある。Web Locks不在時は安全な自動回収を行わないため、このサイトのbrowser storageを手動で消す。元の入力ファイルは変わらない。OPFSは暗号化や秘密消去の保証でもない。
- File/Blob参照でDownloadを行い、保存のためにUI側で再度arrayBuffer化しない。File System Access APIのsave pickerやユーザーフォルダーへの直接stream保存は今回追加していない。

## 予算と停止境界

| 範囲 | 上限・根拠 |
| --- | --- |
| Streaming archive展開済みentry合計 | **2 GiB**。RAM buffer上限ではなく、zip bomb・disk消費・長時間I/Oに対する現段階の安全予算。ZIP32の32-bit fieldsにも余裕を持つ。2 GiBの実機到達を検証したとはしない |
| 各OPFS出力/seek用spool | **2 GiBまたは見積もり空きquotaの80%の小さい方**。他tabの消費・estimate誤差はあり得るので、実write errorも処理する。複数spoolと出力が一時併存し、必要disk量は最終出力サイズより大きい場合がある |
| Blob fallbackの各出力/spool | **64 MiB**。ディスクに逃がせない場合のRAM蓄積を制限。大入力でも小出力なら通せる。全アーカイブ入力への64 MiB制限ではない |
| Archive metadata | **1000 entries、1 MiB filename bytes、128 path components、ZIP filename 65,535 UTF-8 bytes**。大きな本文とは独立。ZIP64等は従来通り未対応 |
| Streaming jobs | **絶対10分 / 無活動120秒**。streamingとして開始した場合だけ30秒budgetを変更。実read/writeの通知と処理stageで無活動timerを更新し、絶対deadlineは延長しない |
| 全量画像 | encoded入出力 **64 MiB**、推定 **256 MiB** working set、Native codecの実能力。カスタム画像の二重読み込みは除去したが、Canvas/bitmap/RGBAを全frame保持する制約は残る |
| 全量音声 | encoded入出力 **64 MiB**、**800万interleaved samples**、batch **32 files / 32 MiB**。48kHz stereoでは約83秒、mono 8kHzでは約1000秒。上限の単純撤廃はWASM heapとPCM copiesを危険にする |
| Buffered codecs | 従来の**30秒**。実際のRangeError/resource failureを別codecへ無条件retryして追加確保しない。診断と回復方法を表示し、縮小/品質変更はしない |

JS・WASM・Native API・OSのメモリは別物。Worker terminateは実行停止と資源所有権の境界であり、OS RSSが直ちに減ることやブラウザ内部のhard sandboxを保証しない。FFmpeg.wasmは未導入。既存libav WASMの仮想FS/32-bit heap、全PCM concat、Native AAC/Mediabunnyの全PCM処理をstreaming対応と偽装しない。

## ベンチマーク：測定した値のみ

`npm run benchmark:phase7` は、同一のdisk-backed TAR入力について、Phase 6のbuffered TAR→Store ZIP→全量検証を再現する経路と、現在のstream経路を**別々の新規Node process**で実行する。現在経路もこの比較ではOPFSではなくbounded Blob fallbackなので、最終出力はRAM側に残る。

ローカルNode v26.0.0 / darwin、各条件1回の観測。`process.resourceUsage().maxRSS` は**プロセス開始以来のピークRSS（KiB）**。V8/runtime/import/File/Blob backendを含み、変換だけのheap peak、unique memory、OS file cacheやChromium/Worker/WASM peakではない。cold importやGCにも影響され、全機種の保証/統計的な平均ではない。

| 入力TAR bytes | 方法 | 出力ZIP bytes | 時間 ms | Node peak RSS KiB |
| ---: | --- | ---: | ---: | ---: |
| 67,072 | buffered | 65,650 | 15.59 | 88,368 |
| 67,072 | streaming/Blob | 65,666 | 34.55 | 90,864 |
| 8,390,144 | buffered | 8,388,722 | 546.86 | 141,328 |
| 8,390,144 | streaming/Blob | 8,388,738 | 350.92 | 126,304 |
| 50,333,184 | buffered | 50,331,762 | 3,623.10 | 398,736 |
| 50,333,184 | streaming/Blob | 50,331,778 | 1,279.81 | 198,896 |

48 MiB本文ケースの観測では**ピークRSS約50%削減**。小容量ではimport/streamのコストで遅く、RSSも増えた。万能な高速化とはしない。ZIPの16-byte差は1 entry分のdata descriptorであり、本文の差ではない。

Chromium 156.0.8078.4、非cross-origin-isolatedな静的build配信では、**100,664,832-byte TAR（96 MiB本文）**から次の実出力を生成した。旧adapterは入力/展開/出力いずれかの64 MiB上限で失敗するサイズである。

| 出力 | 実bytes |
| --- | ---: |
| TAR | 100,664,832 |
| Store ZIP | 100,663,432 |
| TAR.GZ | 100,694,198 |
| GZIP | 100,694,039 |

アプリsinkの計数ではOPFS出力の `retainedBytes=0`、最大write chunkはTAR/ZIP 65,536 bytes、gzip系16,384 bytesだった。**これはsinkがJS配列に保持した出力量/1回のwrite量であり、ブラウザ全体のピークメモリではない。** Browser process/JS heap/Native/WASMのピークは未計測、結果JSONにもnullを記録し、推測で埋めない。

入力/出力・時間・環境・memory測定範囲は `artifacts/phase7/{benchmark,results}.json` に生成する。ブラウザ側の時間はクリック後の待ち時間とDownload保存を含む観測で、純codec benchmarkと比較しない。大きな生成ファイルはgitへ追加しない。検証は `artifacts/phase7/` に約1 GiB規模の再生成可能な入力/出力も作るため、ローカルの空きdiskが必要。

## 検証

`npm test` **105/105成功**、svelte-check **0 errors / 0 warnings**、build/static検査成功。下記の新規・既存ブラウザsuiteもすべて成功。途中で見つかったRangeError文言の互換性は、元の診断情報を残す形で修正して再検証した。

- Node **105 tests**：range-only File（全量arrayBufferを呼ぶと失敗）、65 MiB TAR、OPFSなしで大きな圧縮可能入力→GZIP、ZIP攻撃/CRC/size、bounded sink、Abort、stalled job、temp/URL allocation failure、stale-file/lease保護。
- `test:phase7`：96 MiB TAR→4出力、同じ大容量ZIP/TAR.GZ→TAR。Python tarfile/zipfile/gzipで全本文の長さとSHA256を独立検証。期待hashは `910ee2d8c2e62d71be1aa64f93de21f630fa253475510e07d6401f4bea7455d0`。
- OPFS不在の小容量成功/大容量のbounded failure、open時/commit時のquota failure、RangeError模擬、実encoding中Cancel、ファイル作成待ち中Cancel、gzip入力解析中断と再入力、再実行、Checking outputのstage維持、中間0/完成出力1/clear後0、Worker 0、cross-tab leaseの保持を検査。
- TIFF/BMPでは同じFileを2回全量readしたら例外になる実Workerで変換し、検査済みbytesの再利用を確認。
- **10分、mono 8kHz、480万samplesのPCM WAV→AIFF**を実変換し、独立FFmpegのPCM16 hash一致を確認。これは既存sample予算内の全量処理であり、長時間音声streamingの実装ではない。
- `test:phase4`の20,000px画像、16MP超PNG、32 MiB超入力、破損デコード、mobile警告を回帰確認。画像を勝手に縮小する変更はない。
- 既存の画像/音声/アーカイブ経路、MorphSurface DOM identity、responsive UI、PNG WASM fallback、音声64経路の独立FFmpeg検査、音声Cancel/欠損WASM、初期WASM取得0、外部通信/uploadなしも検査する。

実行: `npm test` / `npm run check` / `npm run build` / `test:static` / `test:browser` / `test:categories` / `test:audio` / `test:checking` / `test:phase4` / `test:phase5` / `test:phase6` / `test:phase7`。既存Playwright/ChromiumとPython/FFmpegを使用し、新規binaryをインストールしない。`build/` を単純な静的HTTP serverで配信。LSP補助ルートは実行コマンド不在でskip、利用にはサーバーのインストールまたは `pi-lsp.json` command修正が必要。型チェックはsvelte-checkで行う。

## 残る制限

- Native Canvas/createImageBitmapは、現在のBlob入力経路に一般的な任意tile/range decodeを公開しない。部分decodeを装って全bitmapを裏で確保しても意味がないため、今回はタイル画像エンジンを追加していない。BMP/TIFF encoder/verificationも全RGBAを使う部分が残る。
- Native AAC、libav圧縮音声は全PCM・全encoded inputを保持。長尺48kHz stereoを以前より大きく処理できたとは主張しない。
- 動画入力/出力、長時間動画、FFmpeg.wasm、ユーザーフォルダーへの直接stream保存は未実装。
- Safari/Firefox実機、mobile実機、2 GiB到達、全Native codec/全OS、ブラウザprocess peakと即時の物理メモリ回収は未検証。
- OPFSはquota/権限/空きdiskに依存する。クラッシュ時の残留データ、storageの暗号化/秘密消去、複数tab/外部processによるdisk消費まで保証しない。

push・deployは行わない。
