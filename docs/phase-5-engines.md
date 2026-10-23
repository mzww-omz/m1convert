# Phase 5 — Capability-driven codec engines

## 実装した範囲

Native Canvas、WebCodecs AAC、libav WASM、PNG WASM、既存の組み込みPCM/画像コーデックを、同じ型付きRegistryから選択・実行する基盤を実装した。**評価だけのエンジンは登録しない。** 新形式や「何でも変換できる」機能を実装済みとは扱わない。

- 画像エンコード：既存PNG/JPEG/WebP/AVIF/BMP/ICO/TIFF経路を移行。PNGには実際に動く独立したWASM代替エンジンがある。
- 音声：PCM WAV出力を含めて、decode → PCM変換 → encodeを新Registryへ移行。AAC→MP3、FLAC→AAC等も別エンジン間でPCMを受け渡す。
- 画像の入力デコード、安全なSVGブリッジ、アーカイブ処理は既存アダプターを維持。これらまで新コーデックRegistryへ移行したとは主張しない。
- 形式/変換経路の `registry.ts` と、実処理の `codec-registry.ts` を分けた。UI/MorphSurface/状態遷移/schedulerを置き換えない。
- `adapter-static` により `build/` を生成。ランタイムNodeサーバー、COOP/COEP、SharedArrayBuffer、CDNを必要としない。

[Phase 4の制約監査](phase-4-constraints.md)の安全境界を引き継ぐ。新しいPNG WASM候補だけは、追加コピーを見込んだ厳しいメモリ予算を持つ。

## 構造

```text
既存UI / Converter
  → createWorkerEngine（各ジョブ1個のmodule Worker / 30秒 / Cancelでterminate）
    → conversion.worker.ts：容量・シグネチャー、既存adapter routing
      → adapter：構造検証、入力デコード、正規化された中間表現
        → codec-registry：形式 / オプション / 環境 / 優先順位で候補選択
          → 必要な候補だけ load → run → 出力検証 → dispose
          → 明示的な互換性/ロード失敗だけ次候補へ
      → 検証済みBlob / selected engine IDs
```

| ファイル | 責務 |
| --- | --- |
| `src/lib/codec-registry.ts` | 汎用の型、環境検出、Capability判定、順序付き遅延実行、フォールバック境界、共通stage/AbortSignal/dispose |
| `src/lib/engines/image.ts` | 画像encoderの軽量な定義とオプション/メモリ判定。実装は動的import |
| `src/lib/engines/audio.ts` | PCM / WebCodecs / libavの独立したdecoder・encoder定義と設定判定 |
| `src/lib/engines/native-image.ts`, `builtin-image.ts`, `png-wasm.ts` | エンジン固有の画像処理。PNG glue/バイナリは同一originの静的資産として遅延import |
| `src/lib/adapters/audio-codec.ts` | シグネチャー/コンテナー検証、Registry decode、PCMリサンプル/チャンネル変換、Registry encode、候補ごとの完全な出力再デコード/検証 |
| `src/lib/adapters/canvas-codec.ts` | 従来の安全な入力デコード/preview、Registry encode、候補ごとの形式/寸法/実デコード検証、Canvas/bitmap所有権 |
| `src/lib/conversion.worker.ts` | 同じjob contextをアダプターへ渡し、Capability宣言と実Worker環境を解析結果に公開 |
| `src/lib/scheduler.ts` | 既存のWorker生成、進捗転送、timeout、Cancel、stale応答破棄、terminate。変更なし |

Registryはメディアの巨大なunionや変換グラフを持たない。`CodecEngine<Input, Output, Options>` の型パラメーターにより、現在は `OffscreenCanvas → Blob`、`{file, bytes} → Pcm`、`Pcm → Uint8Array` を同じ実行規約で扱う。

### decoder / encoder / container

- 音声中間表現は既存のinterleaved Float32 PCM。decoderとencoderは独立に選択できる。リサンプルとチャンネル変換はどのエンジンにも埋め込まない。
- WAV/AIFF、ZIP/TAR/ICO等の既存構造検証・パッケージ処理は独立した関数を再利用する。
- WebCodecsはコーデックであり、コンテナー機能ではない。AACエンジンはMediabunnyでADTS/MP4のdemux/muxを行う。libavはFFmpegのdemux/codec/mux APIを使用する。依存ライブラリーが一体で提供する処理を、名目だけの汎用packet APIで分解しない。
- 画像WASMは**デコーダーではなくPNGエンコーダー**として登録。検証・実デコード済みのRGBA8 Canvasだけを受け取り、元のSVGや未信頼ファイルを直接解釈しない。

## 実装済みのエンジン

`formats` は、decodeなら入力形式、encodeなら出力形式。PNG/PCM等の `builtin` は通常のTypeScript実装であり、ブラウザNative APIやWASMだと偽装しない。

| ID | 種類・操作 | 実装・対応範囲 | 品質/主な限界 |
| --- | --- | --- | --- |
| `native-canvas` | Native / encode | Canvas `convertToBlob`、PNG/JPEG/WebP/AVIFの候補 | PNG lossless、他は1–100のUI品質を0–1へ変換。実形式/寸法/再デコードを検査。ブラウザによってAVIF等は使えない |
| `builtin-image` | builtin / encode | 既存BMP V4、ICO/PNG frames、classic TIFF | RGBA8、固定ICOサイズ、単一ページTIFF。ICO frame生成にはNative Canvas PNGが必要 |
| `wasm-png` | WASM / encode | `@jsquash/png` 3.1.1、PNG RGBA8 | lossless。`20 × pixels + 2 × source bytes <= 256 MiB`、出力64 MiB。単一スレッド |
| `builtin-pcm-decode` | builtin / decode | 既存PCM WAV / uncompressed AIFF | 既存のbits/layout/800万samples検証を維持 |
| `builtin-pcm-encode` | builtin / encode | PCM16 WAV | 元精度保持を保証しない。WAV byte-rateフィールド容量を検査 |
| `webcodecs-aac-decode` | WebCodecs / decode | Native AAC + Mediabunny、AAC/M4A | 実stream/codec/profile・rate/channelsをデコード時に検査 |
| `webcodecs-aac-encode` | WebCodecs / encode | Native AAC-LC + Mediabunny、AAC/M4A | 指定rate/channels/bitrateの実能力照会、生成物の実decodeを要求。Native AAC不在なら使わない |
| `wasm-libav-decode` | WASM / decode | 既存libav、MP3/FLAC/Ogg Vorbis/Ogg Opus | strict CRC/explode、1 stream、mono/stereo、800万samples |
| `wasm-libav-encode` | WASM / encode | 既存libav、MP3/FLAC/Ogg Vorbis/Ogg Opus | MP3/Vorbis bitrateまたはVBR、Opus bitrate、FLAC PCM16。形式固有のrate/bitrate制約と実encode検証 |

音声には現在、同一コーデックの別エンコーダーはない。AACが使えないからといってMP3をAACとして返したり、未導入のFFmpeg.wasmを代替として広告したりしない。

## Capability APIと選択

`src/lib/index.ts` から次を公開する。

- `detectEnvironment()`：Worker内のAPI存在、WASM、SIMD、cross-origin isolationと共有メモリの実生成可否、Canvas、AudioEncoder/Decoder、CompressionStream/DecompressionStream。UA文字列による分岐なし。
- `imageEncoders` / `audioDecoders` / `audioEncoders`：エンジン宣言。種類、操作、形式、形式別品質操作、コンテナー、要求機能、制限を持つ。
- `engineCapabilities(engines, options, environment?)`：形式、機能、オプションから `{...capability, available, reason?}` を返す。実行モジュールの `load()` やWASM初期化を行わない。Native AACの厳密な照会には必要なJSヘルパーを遅延ロードする。
- `runCodec(engines, input, options, context, verify, environment?)`：先頭から適合候補だけをロードし、検証された値と `engineId` / `fallbackFrom` を返す。

`available` は**候補として試せる**という意味であり、任意のデータやネイティブ全形式/全寸法の成功保証ではない。ブラウザのCanvasに共通の正確な最大寸法照会APIはない。UIの `Analysis.outputs` は従来通り実encode/decodeプローブ済みの選択肢であり、実ジョブも再検証する。

`Analysis.codecEngines` はシリアライズ可能な宣言、`Analysis.environment` は実Workerの検出結果。`ConversionResult.engines` には実際に使ったdecoder/encoderとフォールバック元IDを格納する。UIにエンジン選択画面は追加していない。

例（ファイルを送信するAPIではない）:

```ts
const candidates = await engineCapabilities(imageEncoders, {
  format: 'PNG', quality: 90,
  width: 128, height: 80, encodedBytes: file.size
});
```

オプション判定は無効寸法、メモリ予算、品質値、音声sample/rate/channels、MP3のレート別設定、Opus 48000 Hz、WAVフィールド容量等を検査する。音声のOriginal指定と、MP3等への既存の明示的なレート代替を維持する。

## フォールバックと安全境界

1. 入力容量・シグネチャー・構造・悪意あるSVG等の検証は選択より前。壊れた入力を別エンジンで「救済」して正常受理しない。
2. 候補の要求環境と設定を判定。非適合候補はロードしない。
3. `load()` は入力を受け取らない。モジュール取得失敗のTypeErrorはavailability失敗として扱う。それ以外はエンジンが `EngineFallbackError('unavailable' | 'unsupported', reason)` を明示する。
4. 実行中の普通の例外、RangeError/資源枯渇、安全予算エラー、破損入力、Abortは次候補に流さない。エラーメッセージの部分一致で全例外をリトライする実装にはしない。
5. 画像はMIME/signature・構造・実寸法・再デコード、音声は容量・実コーデック・レート・チャンネル・長さまで、候補が受理される前に検証する。互換性として明示できる出力不一致だけ代替可能。要求形式/設定を黙って変更しない。
6. 各sessionの `dispose` を成功/失敗/Abort時に実行し、完了してから次へ。cleanup自体が失敗したらリトライしない。戻り値はsession終了後にも有効な所有済みBlob/配列である必要がある。

実証経路は **Native PNG → 同じPNGをjSquash WASMでencode**。NativeがNotSupportedErrorを返す場合と、誤った出力寸法を返す場合の両方を、実Blobの再デコードで確認した。

## Worker・Cancel・ロード・リソース

- `EngineContext` は共通の `signal` と `stage`。Registryがdecode/encode開始を通知し、コーデックは測定できるframe進捗だけ報告する。出力の再デコードはChecking outputとして扱う。
- 同じ30秒のジョブ予算で全候補を試す。候補ごとにtimeoutを延長しない。
- signalは協調的なチェック。同期WASMや止まらないimportまでJSのAbortSignalだけで中断できるとは主張しない。**Cancel/timeout時のWorker terminateが強制停止の境界**。既存schedulerは変更なし。
- libavの仮想ファイル/codec context、Native AudioSample/Input/Output、画像bitmap/Canvasは既存finallyで解放。WASM heap/glueの最終寿命は使い捨てWorker。失敗したsessionを次候補へ持ち越さない。
- libavは `noworker:true, nothreads:true`。同一Worker内のlibav仮想FSは再入可能ではないため、そのプローブは直列、独立したAACプローブだけ並行実行する。
- PNGは同一originの `vendor/png-3.1.1/encode.js` → `codec/pkg/squoosh_png.js` → WASMの順に必要時だけロード。実行前にlibavやPNG WASMをまとめて初期化しない。
- 初期画面と通常のNative画像変換はWASM取得ゼロ。音声選択時には圧縮出力の能力を知るためlibavプローブが必要になり得る。直接のPCM→WAV実行はWASM不要で、WASM不在でも残る。

## 採用/非採用の比較

npmメタデータと各README/配布ライセンスを調査した。packageのunpacked sizeと、選択したruntime資産のサイズは別物。未導入候補の性能を測定済みとは書かない。

| 候補 | ライセンス・配布サイズ | 互換性/判断 |
| --- | --- | --- |
| Native Canvas / WebCodecs | ブラウザ提供。AAC用Mediabunny 1.62.0はMPL-2.0、遅延chunk約466 KB（gzip約121 KB） | Native優先。正確な設定照会と実変換が必要。ブラウザ/API不在時もWASM/PCMの別経路を残す |
| 既存libav 6.10.9.0 obsolete | LGPL構成。選択runtimeは従来通り約2.56 MiB（gzip約0.97 MiB）、WASM単体2,368,147 bytes | 採用継続。単一スレッドbaseline。ライセンス・対応ソース・差し替え手順も継続配布。詳細は[音声記録](compressed-audio.md) |
| `@jsquash/png` 3.1.1 | npm unpacked 220,994 bytes。Apache-2.0 wrapper、配布codec noticeも同梱 | 第2の独立したWASMとして採用。小さいRGBA8 PNG encoderだけ公開。Native JPEG/WebP失敗を別形式PNGへ勝手に変更する用途には使わない |
| `@ffmpeg/ffmpeg` 0.12.15 + `@ffmpeg/core` 0.12.10 | wrapper MIT、core **GPL-2.0-or-later**、core package unpacked 64,689,644 bytes（複数配布形式合計） | 非採用・未登録。広い形式範囲は魅力だが、GPLの配布判断、動画/CLI込みのサイズ、仮想FSコピー、既存libavとの重複がある。単一スレッド版は候補だが、今回インストール/実測しない |
| `wasm-vips` 0.0.19 | wrapper metadata MIT、libvips等の依存ライセンスは別途確認が必要。package unpacked 12,981,395 bytes | 非採用・未登録。READMEがSharedArrayBuffer/COOP/COEP、SIMD/EHを要求する現行ビルドのため、非isolatedの静的ホストbaselineには不向き。将来single-thread build等を評価する余地はある。性能実測なし |

### 配布サイズと観測値

PNG runtimeは未改変の3ファイルだけを同一originに置く。Viteが別のWASMを重複生成しないよう、glueも静的資産として遅延importする。

| PNG資産 | bytes | gzip bytes（各ファイルを個別圧縮） |
| --- | ---: | ---: |
| `encode.js` | 1,832 | 850 |
| `codec/pkg/squoosh_png.js` | 8,818 | 2,378 |
| `codec/pkg/squoosh_png_bg.wasm` | 181,088 | 84,183 |
| 合計 | **191,738** | **87,411** |

ローカルの純粋な静的HTTP配信 + Chromium 156.0.8078.4で観測した例：初期JS body合計121,814 bytes、WASM取得0。これは未圧縮ローカル配信のResource Timingであり、全ホストのネットワーク転送量やPhase 4との差分保証ではない。

128×80の同じswatchについて、Workerにconvertを送ってから検証済み結果を受けるまでの例はNative PNG約43 ms（592 bytes）、初回PNG WASM fallback約29 ms（1,388 bytes）。各ケース1回の観測で、起動/import/cache/検証を含む。純粋なencoder benchmarkやWASMの高速化・圧縮率優位を主張しない。赤/透明pixelと実寸法を別途検証した。測定ログは `artifacts/phase5/results.json` に生成する。

## 静的ホスティング・再現

- `npm run build` はプリレンダー済みHTML、client JS/CSS、Worker chunks、全vendor/legal資産を **`build/`** に出力する。Nodeサーバーは配布しない。
- ホストはmodule JSをJavaScript、WASMを `application/wasm` として配信する。Workerとglue/wasmは同一origin。COOP/COEPは不要。HTTPSまたはlocalhostで検証する（WebCodecsの要件）。
- `/vendor/` や `/legal/` だけを除外して配布サイズを小さく見せない。LGPL対応ソースも含めてコピーする。
- `npm run sync:audio-assets` / `npm run sync:png-assets` はpin済みnpm配布物をコピーし、manifestのbytes/SHA256を再生成する。PNGのApache/codec noticeも再コピーする。カスタム差し替え後に実行すると上書きされる。
- manifest照合は開発テストであり、利用者が互換ライブラリーを差し替えるのをブラウザで禁止するintegrity checkではない。
- 今回はroot配信を実証。サブパスはSvelteKitのbase設定を合わせて再build/検証する必要がある。製品用サービス追加、push、deployは実施しない。

## 新しいエンジンの追加

1. 対象のInput/Output/Optionsに合う `CodecEngine` を既存の定義リストへ追加する。形式別quality、requirements、limitsを正直に宣言し、`supports` で正確な設定/予算を判定する。
2. `load` でだけ実装モジュールをimportする。トップレベルで巨大ライブラリー/WASMを初期化しない。`run` は同じ要求形式/オプションの所有済み出力を返す。
3. 一時資源はrun内finallyまたはsession.disposeで解放する。初期化失敗・設定非対応だけを明示的なfallback対象にし、RangeErrorや破損入力を互換性失敗へ書き換えない。
4. 既存のアダプター検証を通す。既知形式に別engineを足すだけならUIとschedulerの変更は不要。**新形式**には別途シグネチャー、構造/展開予算、経路登録、コーパステストが必要で、engine登録だけで安全に受理できるとはしない。
5. ライセンス・固定バージョン・self-hosted資産・対応ソース義務、missing feature/load/Cancel/実変換を検証する。

## 検証と残る限界

- Node **88テスト**、`npm run check`（0 errors/0 warnings）、`npm run build`、`npm run test:static` 成功。
- `test:phase5`：本物のNative→PNG WASM fallback、誤寸法出力の再試行、RangeErrorで再試行しない、実asset失敗、実WASMロード中のCancel/再試行、破損入力でロードしない、WebCodecsとlibavの実選択、初期WASMゼロ、非isolated環境、DOM identity、Worker/URL解放、外部通信/uploadなしを検証。
- 既存 `test:browser` / `test:categories` / `test:audio` / `test:checking` / `test:phase4` を静的build配信で回帰確認。126形式ペア（画像54・音声56・アーカイブ16）、従来72経路を維持する。
- ブラウザ試験は既存Chromiumを環境変数で指定し、ダウンロードは行わない。dev serverでは初回の新依存最適化による再読み込みがあったため、最終試験はVite dev/HMRではなくPythonの単純な静的HTTP配信で実施する。
- 補助LSPツールは既定サーバー実行コマンド欠落を報告してスキップした。利用には該当サーバーのインストールまたは `pi-lsp.json` のcommand修正が必要。今回の型検証はプロジェクトのsvelte-checkを使用した。

Firefox/Safariの実機実行、全形式/全音声profile、長尺streaming、プロセスのピークRSSや即時OSメモリ回収は未検証。安全予算はOS sandboxではない。FFmpeg.wasm/wasm-vips、汎用packet graph、任意pluginの遠隔ロード、マルチスレッド経路は未実装。追加の形式/エンジンは、この基盤へ実装と検証を伴って段階的に追加する。
