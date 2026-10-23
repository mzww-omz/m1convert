# Phase 4 — 入力制約の監査と改善

## 方針・監査範囲

対象は `src/lib` 全変換アダプター、Worker入口、scheduler、状態機械、`src/routes/+page.svelte`。容量、画素数、辺長、音声サンプル数・レート・チャンネル・ビットレート・品質、拡張子/MIME、各形式の構造・対応範囲を検索し、呼び出し元とテストまで確認した。下表はPhase 4適用後の判断。過去のPhase 1/2・音声実装記録より本書とREADMEを優先する。

分類は次の意味で用いる。安全予算の具体的な数値は形式規格の最大値ではない。

- **安全上必須**：現行の全量デコード/展開実装で、未信頼データによるメモリ・CPU消費、外部参照、危険な出力パスを制御する境界。無制限化しない。数値の引き上げにはピークメモリ等の検証が必要。
- **技術上必須**：形式のフィールド容量・整合性、実際のデコーダー/エンコーダー能力。名前やMIMEの申告とは区別する。
- **実装都合**：現在のパーサー・中間表現が扱えない機能。ブラウザ一般や形式全体の限界とは主張しない。安全な追加実装を要するものは維持し、理由を記す。
- **不要**：内容が正常でも拒否していた、重複した固定上限・メタデータだけの拒否。

## 撤廃・変更した制約

| 所在 | 以前 | 分類 | 変更・理由 |
| --- | --- | --- | --- |
| `image-format.ts`, `audio-validation.ts`, `adapters/pcm.ts`, `adapters/archive.ts` | 拡張子/MIMEの不一致を拒否 | 不要 | 全カテゴリで撤廃。シグネチャー→構造解析→実デコード/展開を通った内容で判定。不一致はWorkerの解析結果の非ブロッキング警告。空MIME・octet-stream・既知の別名には不要な警告を出さない。出力のMIME/シグネチャー一致検証は撤廃していない。 |
| `conversion.worker.ts` と各read入口 | 入力32 MiB、生成物は64 MiB | 実装都合 | 単一ファイル入力も64 MiBへ統一。33–64 MiBという理由だけでは拒否しない。読み込み前の有限バッファ境界、展開後・画像メモリ・音声サンプル予算は維持。単なる無制限化ではない。 |
| `image-format.ts::checkDimensions` | 8192px/辺、1600万画素 | 不要 | 独立した幾何上限を削除。正の安全な整数と `12 × pixels + 2 × encodedBytes <= 256 MiB` で事前判断。20000×2、4100×4100のPNGを実変換検証。ブラウザ固有のCanvas/エンコーダー限界は別途実処理で判定する。 |
| `image-format.ts::exifOrientation` | EXIF IFD 512エントリー | 不要 | 実バッファ内のIFD長・オフセット検査で置換。16bit個数とファイル予算で走査が有限。方向タグ値・型・個数の検証は維持。 |
| `adapters/archive.ts::read` | `.tgz`/`.tar.gz`だけでTARを要求、空TARの判定も名前依存 | 不要 | gzipを有限展開し、内容だけでGZIP/TAR.GZを判定。名前が誤っていても正しいgzipを拒否しない。TARらしい内容が破損していればTAR解析で拒否する。 |
| `+page.svelte::accept` | 音声バッチは音声拡張子のファイルのみ | 不要 | 名前フィルターを撤廃。先頭の実カテゴリが音声の場合、全ファイルをWorker内で順に解析・変換。混在/破損ファイルは番号・ファイル名・原因付きで失敗し、部分ZIPはダウンロードしない。他カテゴリは従来通り先頭のみ。 |
| `adapters/archive.ts::path` | 240文字/255 UTF-8 bytesの総パス上限 | 実装都合 | ZIPの65535 UTF-8 bytesのフィールド容量まで許可。長い安全なパスは警告で受理し、USTARに収まらない場合はZIPを選べる。パス探索のCPUを抑える128要素上限と、合計ファイル名メタデータ1 MiB予算を設けた。ZIPは文字列展開前にも合計を検査する。 |
| `adapters/pcm.ts`, `audio-validation.ts` | 入力8000–192000 Hzのみ | 実装都合 | プリセット範囲による拒否を撤廃。元レート4000/384000 HzもPCMで正常に往復する。中間表現は正の32bit整数レートを検査し、WAV出力のbyte rateは32bitフィールド容量を別途検査。MP3/Opus/AAC等は出力コーデックの実能力で判定。UIの選択式プリセットは維持し、Originalが元レートを保持する。 |
| `audio-formats.ts`, `machine.ts`, `adapters/audio-codec.ts` | 全形式共通6–510 kbps、共通の少数の選択肢 | 実装都合 | Opusのみ6–510。MP3はMPEGレートごとの規格値（低レート8–160、高レート32–320）を検査。AAC/M4Aは指定設定をネイティブ能力照会、Vorbisは実エンコーダーで判断。共通の510上限を廃止。UIはMP3の40/56/80/112/144/224等、Opusの6/510、Vorbisの480/500、AACの512を提示する。 |
| 同上、`adapters/wasm-audio.ts` | VBRでも未使用ビットレートを必須検査/エンコーダーへ設定 | 不要 | MP3/Vorbis品質モードでは未使用ビットレートを制約にしない。PCM/FLACも不要なビットレート検査をしない。品質値は実コーデックのqscaleへ変換する。 |
| `adapters/canvas-codec.ts`, `adapters/wasm-audio.ts`, `adapters/native-aac.ts` | 汎用的なエンコード失敗だけ | 実装都合 | 実形式・要求解像度、またはレート/チャンネル/ビットレートと、PNG/WAV・低ビットレート・VBR・別レート等の代替を提示。小さいプローブの成功を全サイズ/全設定の保証とは扱わない。出力の再解析・再デコード・寸法/音声パラメーター照合を維持。 |

ビットレートの整数表現境界（kbps→bpsが符号付き32bitに収まる値）はエンコーダー呼び出しの技術境界であり、推奨ビットレートではない。さらに長さから推定した目標出力が63 MiBを超える場合は、コンテナー余裕1 MiBを含む64 MiBバッファ予算として、エンコード前に低ビットレート/分割を案内する。実出力も64 MiBを検査する。レート・チャンネルに依存するVorbisの対応範囲を、固定の共通上限で偽装しない（48kHzステレオで500 kbpsは成功、512 kbpsは実エンコーダーが拒否）。

## 維持した共通制約

| 制約・所在 | 分類 | 維持理由・動作 |
| --- | --- | --- |
| 単一入力/出力64 MiB（Worker、各アダプター、出力検証） | 安全上必須 | Blobから全量ArrayBuffer化する実装の有限バッファ予算。形式規格の上限とは表示しない。入力の縮小・分割を案内。 |
| 画像256 MiB推定作業領域、正の整数寸法 | 安全上必須 / 技術上必須 | ネイティブデコードとCanvas等の割り当て前に検査。不正寸法・オーバーフロー相当の積は拒否。ネイティブ内部やプロセスRSSを256 MiBに隔離する保証ではない。 |
| 音声800万interleaved samples（`audio-validation.ts`, `pcm.ts`, `wasm-audio.ts`, `native-aac.ts`） | 安全上必須 | PCM本体だけで32 MB。デコーダーチャンク、連結PCM、変換後PCM、出力再デコード、WASMヒープが同時に必要。宣言値と実デコードの累計、リサンプル後を割り当て前に検査。48kHzステレオ約83秒。長尺対応にはストリーム化が必要。 |
| 音声バッチ32ファイル/合計32 MiB、合計出力64 MiB | 安全上必須（現行バッチ実装） | 逐次処理だがZIP用の結果全件を保持し、ZIPと再検証用バッファも作る。単一入力64 MiBとは別予算。現在は一括成功/失敗。 |
| 1 converterあたりWorker 1個、全ジョブ30秒 | 安全上必須 | CPU/ネイティブ処理の有限実行時間。Cancel/置換/reset/timeout/errorでterminate。大きい正当なファイルも時間制限に達し得るため、小さいファイル/バッチを案内。 |
| raw入力プレビュー禁止、thumbnail最大320×180、Blob URL/bitmap/Canvas解放 | 安全上必須 | 未検証データのDOM挿入・ソースSVG表示を避け、ファイル置換や失敗後にリソースを残さない。MorphSurface本体とlayout CSSは変更していない。 |
| 品質1–100、音声設定のUIプリセット | 実装都合（UI値の定義） | 品質はCanvas 0–1やコーデックqscaleへ正規化する操作値で、規格の絶対品質とは主張しない。数値不正を拒否。losslessでは不要な品質/ビットレート操作を表示しない。 |
| 出力MIME/シグネチャー/構造、実デコード、寸法/音声形式・レート・チャンネル・長さ照合 | 技術上必須 | 入力のラベル許容とは別。PNGへの暗黙fallback、切り詰めた寸法、別コーデック、破損出力を正常として返さない。 |

## 形式別の全監査台帳

### 画像

| 所在・対象 | 維持した制約 | 分類・理由 |
| --- | --- | --- |
| `formats.ts`, `registry.ts` | 登録形式のシグネチャー、入力/出力経路、実エンコーダープローブ | 形式確認は技術上必須。Workerの先頭4096 bytes検出とAVIF brand/SVG rootの4096 bytes探索は残る実装都合（巨大な前置き/ftypの一般化は未実装）。拡張子/MIMEだけでは登録外内容を受理しない。新コーデックを推測で追加しない。既存72経路および追加済み経路の登録は変更なし。 |
| `image-format.ts` PNG | IHDR/chunk範囲、IDAT/IEND、末尾、EXIF範囲。APNG拒否 | 構造は技術上必須。アニメーションは実装都合で維持（全フレーム対応なし、無告知の静止画化を避ける）。圧縮ピクセルはネイティブ実デコードで検証。 |
| 同 JPEG | SOF0/1/2のみ、終端/marker範囲、EXIFの型・orientation 1–8 | 境界・整合性は技術上必須。それ以外のSOFは実装都合。対応追加には寸法とデコード一致の検証が必要。 |
| 同 WebP | RIFF長/chunk/padding/VP8/VP8L/VP8X整合、EXIF、ANIM/ANMF禁止 | 構造は技術上必須。動画/animation禁止は実装都合。出力サイズの実能力はエンコーダー応答と再デコードで確認。 |
| `adapters/bmp.ts` | DIB 40/108/124、24/32bit、BI_RGBまたはV4/V5標準RGBA BI_BITFIELDS、行サイズ・ヘッダー/画素範囲 | 構造は技術上必須。palette/16bit/RLE/独自mask非対応は実装都合。デコーダー追加なしで受理すると誤った色や読み出しを招くため維持。 |
| `adapters/ico.ts` | 1–64フレーム、非重複範囲、ディレクトリーと実寸法一致、PNG/DIBのみ | 64個は安全な検証量の予算。1–256pxはICOディレクトリーの技術境界。DIBはBITMAPINFOHEADER、24/32bit無圧縮・AND maskのみという実装都合。出力16/32/48/256は既存アイコンプリセット、入力の辺長制限ではない。 |
| `adapters/gif.ts` | GIF87a/89a、palette/block/descriptor/LZWコードサイズ2–8、1フレーム、loop拡張拒否 | 構造は技術上必須。単一フレームは実装都合（アニメーションを黙って破棄しない）。ネイティブ実デコードを要求。 |
| `adapters/tiff.ts` | classic TIFF、1 IFD、1–128タグ、1値配列4 Mi elements、必要タグ配列8192要素以下、全範囲/strip/重複検査 | 境界は技術上必須、配列・タグ個数はパーサーの安全予算。将来緩和にはJS配列の合計メモリ計算が必要。single-page/uncompressed/chunky/8bit RGB/RGBA/unassociated alpha/orientation1のみは実装都合。ICC/transfer function拒否は誤った色を正常出力としないため（色管理未実装）。BigTIFF/圧縮等の新デコーダーは今回追加しない。 |
| `adapters/avif.ts` | BMFF深さ6/4096boxes、範囲検査、8bit still、同一ispe、av1C/mdat/meta必須 | 深さ/個数は安全予算。8bit以外、HDR、grid/crop/rotation/mirror/unequal auxiliary/sequence拒否は実装都合（色・向き・合成の正確な扱い未実装）。ネイティブAVIFの可否を実デコードで判定、プロファイル保持の保証なし。 |
| `adapters/svg.ts` | UTF-8、1 MiB、4 MP、10000タグ、深さ64、64 KiB/tag | 安全上必須。SVGはラスターの画素数だけでは処理コストを評価できない。一般画像の独立画素上限撤廃とは別に維持。 |
| 同 SVG / `svg-raster.ts` | 静的タグ/属性allowlist、数値/px/viewBoxのみ。script/event/foreignObject/CSS/text/font/image/use/animation/外部参照/DTD/entity/comment等を拒否 | 能動内容・参照は安全上必須。安全性を証明する最小サブセットの実装都合も含む。無断で一部を削除して正常受理しない。検証後だけ非同期Blob-imageで描画し、Cancel/timeoutでURLと画像を解放。 |

### 音声

| 所在・対象 | 維持した制約 | 分類・理由 |
| --- | --- | --- |
| `pcm.ts`, `audio-validation.ts` | mono/stereo、sample count・レート整数/範囲、実デコードPCMのfinite検査 | チャンネル1/2は実装都合（mixing/layout処理が1/2専用）。NaN/Infinityと不整合は技術上必須。サンプル予算は上表。 |
| `adapters/pcm.ts` WAV/AIFF | RIFF/FORM長、全chunk範囲/padding、fmt/COMM/SSND重複、block align/byte rate、frame数整合。8/16/24/32bit integer、WAV float32/限定extensible | 範囲/整合は技術上必須。圧縮WAV、AIFC、他subtype/layout、AIFF sound block非対応は実装都合。WAV/FLAC出力PCM16は既存中間表現・量子化仕様。精度維持の新機能は今回追加しない。 |
| `audio-validation.ts` MP3 | ID3v2.3/2.4のみ、metadata4 MiB、全MP3フレーム連鎖、レート/チャンネル一定、free-format非対応 | frame整合は技術上必須。metadata4 MiBは解析/codecメタデータ予算。ID3版・free-format・途中切替非対応は実装都合。 |
| 同 Ogg Vorbis/Opus | 全page CRC、serial/sequence/BOS/EOS、単一stream、Opus mapping family0/version1 | CRC/範囲は技術上必須。chained/multiplexed/他mappingは実装都合（単一PCM表現に無告知で落とさない）。 |
| 同 FLAC | STREAMINFO、metadata走査4 MiB、重複STREAMINFO禁止、宣言総sample数と実デコード一致 | 範囲/一致・strict decoder checksumは技術上必須。metadata走査は安全予算。既知sample数ゼロでも実デコード累計の予算を適用。 |
| 同 ADTS/AAC | AAC-LC、ADTS frame長・rate/channels一定、raw data block数固定 | 範囲は技術上必須。他profile・変動パラメーターは実装都合。実AACコーデックをネイティブで別途検査。 |
| 同 MP4/M4A、`native-aac.ts` | box深さ16/10000boxes、sample table100000件、全box/table範囲/offset/size一致 | 深さ/件数は安全予算。single-track AAC、mp4a1 description、非fragmented、QuickTime version0、stz2非対応、子boxのextended size非対応は実装都合。ALAC/video/複数streamをAACとして受理しない。追加にはdemux/検証系の拡張が必要。 |
| `audio-formats.ts`, `wasm-audio.ts` | MP3レート集合/レート別bitrate、Opus出力48000Hz・6–510kbps | 技術上必須（実採用encoder/container）。元レートがMP3非対応ならoriginal指定時は48000へ代替。明示指定が非対応なら設定変更を案内。UIのformat変更時は表示値を互換な選択肢へ更新する。 |
| `native-aac.ts`, `audio-codec.ts` | WebCodecs、実AAC codec/config照会、実encode/mux/decodeプローブ、出力長の許容差 | 技術上必須。AAC非対応のブラウザに偽の出力を提示しない。WAV等を代替に選べる。WASM追加やサーバーfallbackはなし。 |

### アーカイブと実行制御

| 所在・対象 | 維持した制約 | 分類・理由 |
| --- | --- | --- |
| `adapters/archive.ts` | 1000 entries、合計展開64 MiB、出力64 MiB、ZIP申告長と実inflate長/CRC、gzipのincremental上限 | 安全上必須 / 技術上必須。ZIP爆弾・偽サイズは展開前/展開中に止める。圧縮率だけで正当な繰り返しデータを拒否するルールはない。再帰的な自動展開・filesystem抽出もない。 |
| 同 path検証 | 相対安全パス、空/`.`/`..`/絶対/drive/colon/backslash/control/末尾dot-space/Windows予約名禁止、NFC+case-fold重複・親file衝突禁止、links/devices禁止 | 安全上必須（受け取ったZIPを利用先で展開しても危険にしない）。長さの互換性警告とは分離。新しいメタデータ予算・深さ上限は上表。 |
| 同 ZIP | store/deflateのみ、UTF-8/ASCII名、単一disk、非暗号化・非ZIP64、認識外flag禁止、central/local/descriptor一致、record非重複/非alias | 構造は技術上必須。それ以外の圧縮/文字コード/暗号化/ZIP64等は実装都合。32bitサイズが64 MiBバッファ内でもZIP64を解釈する実装はまだない。 |
| 同 TAR | POSIX USTARのみ、512-byte block、checksum/octal/zero-padding/2 end blocks、regular file/directoryのみ | 整合とリンク禁止は技術/安全上必須。GNU/PAX/sparse/他numeric、USTAR名100-byte + prefix155-byte非対応は実装都合/選択した出力形式の技術境界。表現できない場合はTAR/TAR.GZを非表示にしZIPを提供する。 |
| 同 GZIP/TAR.GZ | 実CompressionStream/DecompressionStream能力、GZIP出力はregular file1個 | 技術上必須。GZIPそのものに複数file階層表現はなく、複数ファイルはZIP/TAR.GZで提供。native deflateがなければZIP storeに代替。 |
| `scheduler.ts`, `machine.ts`, `converter.svelte.ts`, `results.ts` | runId/stale応答拒否、AbortController/terminate、30秒、URL/bitmap/canvas解放、出力名のpath/control除去 | 安全上必須。今回も維持。ファイルはローカルBlobのみで、upload、storage永続化、CDN codec取得、サーバー変換は追加していない。 |

## 検証

- `npm test`：78テスト成功。境界値、容量予算、ラベル不一致、実33 MiB入力、破損構造/圧縮データ、音声実エンコーダー、長い安全なZIPパス、パストラバーサル・ZIP爆弾・SVG・Cancel/リソース解放の回帰を含む。
- `npm run check`：0 errors / 0 warnings。`npm run build`：成功（adapter-autoは従来通りデプロイ先未指定の案内を出す）。
- 既存Chromium **156.0.8078.4**で6ブラウザスイートを逐次実行し全成功。**126形式ペア（画像54・音声56・アーカイブ16）**を実変換。従来72経路を維持し、ネイティブAAC 512 kbpsも独立FFmpegでデコード確認。
- ブラウザ：`test:browser`（全54画像経路/品質/向き/Cancel/320px/DOM identity）、`test:categories`（16アーカイブ経路、PCM、拡張子を偽った音声バッチ）、`test:audio`（56音声経路、独立FFmpeg検証とlifecycle）、`test:checking`、新設 `test:phase4`。
- `test:phase4`：20000×2と4100×4100のPNG変換、WebPが要求横幅を保持しない場合の具体的な回復案内、実33 MiB PNGのnative decode/変換、壊れた圧縮ピクセルの拒否、320px幅の互換性警告、MorphSurface同一性、外部通信/アップロードなし。画像は偽ヘッダーで成功扱いにせず、ブラウザで生成して本当に変換する。
- テスト用Playwrightのin-memory uploadには50 MiB制限があるため、64 MiB超の拒否テストは一時的な実ファイルを使用し、finallyで削除する。製品の制限とは無関係。
- 初回のブラウザ並行実行では待機timeoutが発生。最終確認は逐次実行で全成功。Playwright既定のbrowser revisionが未配置だったため、`PLAYWRIGHT_MODULE` / `PLAYWRIGHT_EXECUTABLE_PATH`で既存モジュールとChromiumを明示し、ダウンロードは行っていない。
- 補助LSP診断ツールは既定サーバーの実行コマンド欠落を報告してスキップした。利用には該当サーバーのインストール、または `pi-lsp.json` のcommand修正が必要。今回の型検査はプロジェクトの `svelte-check` で成功し、環境設定や依存は変更していない。

## 残る限界

有限の安全予算を超えるファイルは引き続き拒否する。native decoder/encoderの内部メモリ、OS回収時刻、全ブラウザでのCanvas最大寸法は測定・保証していない。30秒以内に処理できない正常ファイルもある。長尺PCMのstreaming、完全SVG/TIFF/AVIF/MP4、任意チャンネルや新コーデックは今回追加していない。これらを「形式上変換不可能」とは表示/記述しない。push・deploy・依存追加は行わない。
