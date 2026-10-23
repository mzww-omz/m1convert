# Phase 6 — 画像・音声の段階的な経路拡張

## 今回の成果と境界

Phase 5のRegistry、Worker、Canvas/WebCodecs/libav経路を維持し、**8つのAIFF出力経路**と**TIFF入力の実デコード範囲**を追加した。依存・WASM・サービス・通信先は追加していない。AVIF出力の全ブラウザ対応、HEIF、アニメーション、動画まで完成したPhaseではない。

Phase 5ですでにMP3、FLAC、Ogg Vorbis、Ogg Opus、AAC-LC/ADTS、AAC-LC/MP4は動作していた。これらを今回の新機能とは数えない。既存の[エンジン構造](phase-5-engines.md)、[圧縮音声のライセンス・配布手順](compressed-audio.md)、[安全境界](phase-4-constraints.md)を引き継ぐ。

## 新規の実変換経路

| 入力 | 新規出力・処理 | 実エンジン |
| --- | --- | --- |
| PCM WAV / uncompressed AIFF | PCM16 AIFF | builtin-pcm-decode → builtin-pcm-encode |
| MP3 / FLAC / Ogg Vorbis / Ogg Opus | PCM16 AIFF | wasm-libav-decode → builtin-pcm-encode |
| AAC-LC ADTS / AAC-LC M4A | PCM16 AIFF | webcodecs-aac-decode → builtin-pcm-encode |
| PackBits圧縮TIFF、8/16-bit RGB・非関連alpha RGBA | PNG / JPEG / WebP / BMP / ICO / TIFF、AVIFはNative利用可能時 | TIFFデコーダー → 既存imageEncoders |
| WhiteIsZero / BlackIsZero TIFF、unsigned 8/16-bit、非圧縮またはPackBits | 同上 | TIFFデコーダー → 既存imageEncoders |

AIFFはFORM/COMM/SSNDを構築し、80-bit extended Hz、フレーム数、big-endian PCM16を実際に書く。WAVのヘッダーを書き換えるだけではない。8つの音声入力からそれぞれAIFF出力可能。形式ペア総数は**134 = 画像54 + 音声64 + アーカイブ16**（検証Chromium）。既存72経路を維持。TIFF入力の圧縮/bit-depth差は新しい「形式ペア」として水増ししない。

### 品質、オプション、メタデータ

- AIFFはWAV/FLAC出力と同じPCM16精度。整数Hz、mono/stereo、既存sample-rate/channel設定に対応。圧縮しないのでbitrate/品質の架空操作は表示しない。通常のサンプルレート変更は既存64-tapリサンプラーを使用する。
- 同じrate/channelsのPCM16 WAV/AIFF/FLAC → AIFFは、再量子化によるサンプルの変化なしを独立FFmpegデコードで検証。24/32-bit/float入力の精度維持は保証しない。すでに非可逆の入力からAIFFにしても情報は復元しない。
- AIFFはmetadata-free。元title/artist/cover artは移さない。圧縮入力には元codecのpaddingや遅延が残る場合がある。
- TIFFの16-bitは `round(value / 257)` で8-bitへ変換。WhiteIsZeroは反転し、alphaは非関連のまま処理する。**16-bit出力・HDR・色管理を実装済みとはしない。** UIにも8-bitへの変換を表示する。
- TIFF出力は従来通り単一ページの非圧縮RGBA8。画像metadataは削除する。JPEGは白背景、ICOは既存の4サイズ。GIF/WebPのアニメーションを黙って最初のフレームに潰す変更はしていない。
- 動画のremuxはpacketをcodec変更なしに別containerへ入れる処理、再エンコードはdecode/encodeである。今回そのどちらも新たに公開していない。WAV→AIFFのPCM16保持を、動画や圧縮音声の汎用remux機能とは呼ばない。

## 候補調査・採否

npmのversion/license/dist.unpackedSizeと、既存実装、AVIFの配布tarballのREADME・encode.js・meta.js・LICENSE・codec READMEを確認した。**npm unpacked sizeは実配信量ではない。** 未導入候補の速度・互換性は測定値ではない。ライブラリーのライセンスは特許の包括許諾を意味しない。

| 優先形式・候補 | ライセンス / 配布サイズ | 実現性・性能・採否 |
| --- | --- | --- |
| WAV ↔ AIFF / 組み込みPCM | 新規第三者ライブラリーなし / 小さなTS追加のみ | 採用。線形処理で、既存PCM表現・検証を再利用。16-bitではサンプル保持可能。音声800万samples上限を維持 |
| TIFF PackBits・unsigned16/gray / 組み込み | 新規第三者ライブラリーなし | 採用。PackBitsは展開先・各行境界を検査でき、線形に処理可能。CanvasのRGBA8制限は明示。LZW等まで独自実装を拡大しない |
| TIFF全般 / `utif` 3.1.0 | MIT、npm unpacked 63,999 bytes | 小さく幅広い圧縮の候補。ただし各方式・IFD/strip/tile・展開予算を今回の検証器と統合する作業が必要。未導入、未実測。次の圧縮TIFF拡張候補 |
| AVIF / Native Canvas | ブラウザ提供、追加配布0 | 既存経路を維持。CanvasがPNGを返す場合は不成立として非表示。今回のChromiumはNative AVIF出力なし。WebCodecsのAV1 encoderはAVIFコンテナーwriterではない |
| AVIF / `@jsquash/avif` 2.1.1 | wrapper Apache-2.0、npm unpacked 8,360,482 bytes | tarballを調査。single-thread encoder glue 39,621 + WASM 3,485,872 bytes（各gzip合計1,131,423 bytes）。全packageにはdecoder/MTも含む。8/10/12-bit設定はあるが、Canvas入力は8-bit。未導入。上流libavif/libaom等の同梱noticeを揃え、単一threadだけ自己配信し、30秒予算・速度・メモリとAVIF probe時の約3.5MB取得コストを検証してから追加する |
| HEIC/HEIF / `heic-decode` 2.1.0 + `libheif-js` | wrapper ISC、6,656 bytes。依存libheif-jsのmetadataはLGPL-3.0、9,046,551 bytes | wrapperの小ささだけでは採用しない。HEIFはコンテナー、HEVC等はcodec。対応codec/複数画像/向き/color depthと、ビルド内依存のライセンス・対応ソース・メモリを調査する必要。未導入 |
| アニメーションGIF / `gifenc` 1.0.3 | MIT、npm unpacked 172,516 bytes | encoder候補。decoder/compositor・palette量子化・alpha/disposal/loop/delay保持は別問題。フレーム累積予算と独立再生検証が必要。未導入。まだ入力を明示拒否する |
| アニメーションWebP / ImageDecoder + `@jsquash/webp` 1.5.0 | Native ImageDecoder + Apache-2.0 wrapper、npm unpacked 914,811 bytes | ImageDecoderは対応照会が必要。jSquashのstill-image APIだけではアニメーションmuxを満たさない。フレーム合成・timestamp/mux・予算まで実装するまで非対応 |
| MP3/FLAC/Vorbis/Opus / 既存libav 6.10.9 | 既存LGPL構成、選択runtime約2.56MiB（既存配布） | 継続。新規巨大FFmpeg coreを重複追加しない。MP3/Vorbis bitrate/VBR、Opus bitrate/48kHz、FLAC PCM16、rate/channelsは既存の実encoderに合わせる |
| AAC / WebCodecs + Mediabunny 1.62.0 | Native + MPL-2.0、既存遅延chunk約466KB | 継続。ADTS/MP4 demux/muxはMediabunny、codecはAudioEncoder/Decoder。Native不在時は非対応。ブラウザ標準だから全端末同一とは扱わない |
| MP4/WebM、H.264/H.265/VP9/AV1、音声抽出 / WebCodecs + 既存Mediabunny | Native + 既存MPL-2.0 | 将来の第一候補。VideoEncoder/Decoder個別照会、container/codec組合せ、timestamps/keyframes、映像/音声同期、metadata、stream資源と出力再デコードの検証が必要。H.265等をOS依存なしと宣言しない。音声抽出も今回未実装 |
| 同上 / `@ffmpeg/core` 0.12.10 | GPL-2.0-or-later、npm unpacked 64,689,644 bytes | 不採用。全packageを無条件追加しない。codec構成とライセンス配布判断、FSコピー、長尺動画のメモリとCancel境界が必要。未導入・未実測 |

参照: [jSquash AVIF](https://www.npmjs.com/package/@jsquash/avif)、[libavif](https://github.com/AOMediaCodec/libavif)、[heic-decode](https://www.npmjs.com/package/heic-decode)、[libheif-js](https://www.npmjs.com/package/libheif-js)、[gifenc](https://www.npmjs.com/package/gifenc)、[UTIF](https://www.npmjs.com/package/utif)、[jSquash WebP](https://www.npmjs.com/package/@jsquash/webp)、[WebCodecs](https://www.w3.org/TR/webcodecs/)、[Mediabunny](https://mediabunny.dev/)。

候補のインストールや新binaryの配布はしていない。AVIF tarballは調査用一時領域だけに展開し、repositoryやbuildには含めない。既存 `static/legal/` と対応ソースは引き続き配布する。

## Worker・検証・資源

- AIFFは `audioEncoders` のbuiltin-pcm-encodeに追加。format routing、出力候補、PCM adapter呼び出し元、品質判定、UIのbitrate非表示、出力検証まで更新。新しい並列ランタイムは作らない。
- AIFF出力はシグネチャーだけでなく、実際に全sampleを再デコードしてrate/channels/durationを確認してから返す。AIFFのduration許容差はWAV/FLACと同じ1sample。
- TIFFはヘッダー検査時にもPackBitsを走査し、sourceの短さ、出力不足、過展開、行をまたぐrunを拒否。IFD、strip、tag配列の範囲重複を拒否。pixel確保より前に検査する。
- TIFFの追加strip bufferを含め `20 × pixels + 2 × source bytes <= 256MiB` に制限。入力64MiB、出力64MiB、8M audio samples、既存30秒deadlineを維持。TIFFに以前より保守的なメモリ上限がかかる場合がある。
- FillOrder=2、Predictor≠1、signed/float TIFF、ICC/transfer functionは拒否。未対応の変形を無視して誤ったpixelを成功扱いしない。
- builtin処理は同期ループのため細かい百分率は捏造せず既存のreading/decoding/encoding/verifying stageを使用。AbortSignalは境界で確認、同期処理中のCancelはschedulerのWorker terminateが停止境界。再試行では新Workerとなり、古い結果は破棄される。
- AIFF encode自体はWASMを必要としない。圧縮入力では必要な既存decoderだけがロードされる。出力候補検査の既存音声probeは引き続き必要に応じlibavをロードする。初期画面とNative画像変換はWASM取得0のまま。

## 検証・再現

検証結果：`npm test` **95/95成功**、`npm run check` **0 errors / 0 warnings**、`npm run build`、`test:static` 成功。既存 `test:browser` / `test:categories` / `test:audio` / `test:checking` / `test:phase4` / `test:phase5` と新規 `npm run test:phase6` も成功。ブラウザは既存PlaywrightとChromiumを環境変数で指定し、新たにダウンロードしない。`build/` をPythonの単純なHTTP serverで配信、COOP/COEPなし。

- 新規TIFF fixturesはPillow 12.3.0で生成。`python3 scripts/phase6-fixtures.py` で再生成可能（Pillowは実行時依存ではない）。32×16 RGB PackBits、16-bit gray little/big endianを格納。
- Node testsは独立手書きIFDの8/16-bit RGB/RGBA、両byte order、white/black gray、16-bit PackBits、literal/repeated run、切断・過展開・不足、predictor/fill order/signed拒否、AIFF Hz上限/非有限samples/レイアウトを検査。
- Phase 6 browser suite：**26実変換**（3種の新TIFF入力×6出力 + 8音声入力→AIFF）。TIFF→PNG/BMP/TIFFは全pixel一致。さらにPillowで9つのPNG/BMP/TIFF成果物を独立デコードし、元TIFF（16-bitは明示の8-bit丸め）との全pixel一致を確認。出力signature/構造/寸法を検証。AIFF bitrate非表示、rate/channels/実samples、実resampling中Cancel→同設定でretry、Worker/URL解放、外部通信/uploadなしを確認。
- 既存audio-browserをAIFF追加に追従し、**64経路すべて**をFFprobe/FFmpegで独立codec/rate/channels/duration/metadata/SNR検査。PCM16 WAV/AIFF/FLAC→AIFFは全sampleの完全一致も検査。
- 独立FFmpegのs16le出力比較でも上記3経路は各384,000 bytesが一致（SHA256 `ca543696082799f573fea87cc15bbaab557d9d3fa927622f792f2e13db0682c2`）。AIFF container自体のbyte一致や元metadata保持ではない。
- ローカルChromium 156.0.8078.4、2秒stereo 48kHz fixtureでAIFF変換は約207–315ms/回（実conversion開始からUI download-readyまで、Worker・検証・UIを含む各1回の観測）。WAV/AIFF/FLAC入力は384,054-byte AIFF。純encoder benchmarkや全機種への性能保証ではない。
- ログは `artifacts/phase6/results.json`、既存 `artifacts/audio/results.json` 等へ生成。成果物をrepositoryに大量追加しない。
- LSP補助チェックは設定されたサーバー実行コマンドが利用できずskip。必要ならサーバーをインストールするか `pi-lsp.json` のcommandを修正する。型/コンポーネント検証にはプロジェクトのsvelte-checkを使用。

Safari/Firefox実機、任意のTIFF/音声ファイル、長尺streaming、ピークRSS、即時のOSメモリ回収は未検証。新しいAVIF WASM/HEIF/アニメーション/動画経路は未実装。push・deployは行わない。
