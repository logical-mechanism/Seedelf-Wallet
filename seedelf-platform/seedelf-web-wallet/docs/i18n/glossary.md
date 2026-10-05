# Translation glossary

The words that must be the same everywhere, so a user reading Spanish or
Japanese meets one wallet rather than three. Checked against **Lace 2.4.2**'s
own `es.json` and `ja.json` (`_reference/lace`, pulled 2026-10-02) wherever Lace
says the same thing, because a Cardano user arriving from Lace should recognise
the word.

## Never translated

**Seedelf**, **Seedelf Wallet**, **Lovejoin**, **Koios**, **Cardanoscan**,
**giveme.my**, **Minswap**, **Preprod**, **mainnet**, **ADA Handle**, **UTxO**,
**CIP-30**, **DRep**, **ADA**, **₳**. Seedelf is the name and
`extension/tests/i18n.test.ts` checks it in every locale, as
`extension/tests/words.test.ts` does in the source.

**Seedelf and Lovejoin are brands and are never transliterated** — not
シードエルフ, not ラブジョイン. The two network names are Cardano's own and stay
Latin in every language: the *sentence* around them is translated ("Preprod, la
red de pruebas de Cardano"), the name is not. The owner asked for this
explicitly (2026-10-03), and there is no Spanish or Japanese form of either
brand that would make sense.

**The recovery phrase itself** is never translated: the 24 words are BIP39's
English list and the derivation is frozen. The screens *about* the phrase are
translated; the words on them are not.

## The terms

| English | Spanish | Japanese | Note |
|---|---|---|---|
| wallet | billetera | ウォレット | Lace's choice |
| account | cuenta | アカウント | Lace's |
| public account | cuenta pública | 公開アカウント | the wallet's own term |
| private balance | saldo privado | プライベート残高 | the wallet's own term |
| Receive | Recibir | 受取 | Lace has 受信, "receive a signal"; 受取 is what money does — we part from Lace here deliberately, as for Home's Send |
| Send | Enviar | 送金 | Home's Send, which pays: 送金, where Lace has 送信. The review's Send button, which submits the transaction, keeps Lace's 送信 |
| transaction | transacción | トランザクション | Lace's |
| Collateral | Colateral | コラテラル | Lace's |
| Stake | Stake | ステーク | Lace's: left in English |
| stake address | dirección de staking | ステークアドレス | |
| recovery phrase | frase de recuperación | リカバリーフレーズ | Lace's |
| password | contraseña | パスワード | Lace's |
| Confirm password | Confirmar contraseña | パスワードの確認 | Lace's |
| Back | Atrás | 戻る | Lace's |
| Close | Cerrar | 閉じる | Lace's |
| Copy | Copiar | コピー | Lace's |
| chain | cadena | チェーン | |
| script | script | スクリプト | |
| token | token | トークン | |
| make private / make public | hacer privado / hacer público | プライベートにする / 公開する | the wallet's own flow names |

## Chosen in the whole-locale review (2026-10-03)

Not the owner's decisions, like the table above: these are the words a Claude
review settled when it read every Spanish and Japanese value end to end, each
applied to every key that says it. It decided in this order: this file, then
Lace where Lace says the same thing, then the reviewer, then the majority. Any
of them is the owner's to overrule.

### Spanish

| English | Spanish | Note |
|---|---|---|
| fund, funded, funding | financiar, financiada, financiación | Lace's "Financiar mi billetera"; never "fondear" |
| mint | acuñación, acuñar | Lace's; never the English "mint" in a sentence |
| slippage | margen de tolerancia | Lace's; the custom value is "El tuyo" |
| stake pool | pool de staking | Lace's; "pool" alone where English says "pool" |
| stake key, stake part | clave de stake, parte de staking | Lace's "Clave de stake" |
| remove, removal | eliminar, eliminación | Lace's; "Quitar" only for taking a recipient off a payment |
| cost | costo | Lace's; "coste" is Spain's |
| withdrawal | retiro | Lace's; the verb stays "retirar" |
| treasury | tesoro | Lace's |
| no confidence (a governance action) | una moción de desconfianza | Lace's; the DRep vote option stays "Siempre sin confianza", as Lace's |
| fill an order, place an order | ejecutar, enviar la orden | |
| Max (the button) | Máx | Lace's, no period; sentences name it the same way |
| ticker | ticker | Lace's; never "símbolo" |
| Settings (the screen) | Configuración | Lace's and Chrome's; replaced "Ajustes" |
| Enter (a value) | Ingresa | Lace's; "Introduce" is Spain's |
| Done (a button); Done, Failed (a status) | Listo; Completado/Completada, Fallido | Lace's |
| transaction ID | ID de transacción | always a capital "ID" |
| quotation marks | “ ” | never « » |
| about (an amount) | (aprox.) in a label, aproximadamente in a sentence | a label can't end in "unos" |
| IPFS gateway; metadata (chunk 20) | pasarela IPFS; metadatos | "gestionada por Blockfrost", never "que gestiona Blockfrost", which reads as the gateway managing Blockfrost |

### Japanese

| English | Japanese | Note |
|---|---|---|
| browser | ブラウザ | Lace's; not ブラウザー |
| register (a Seedelf's) | レジスター | not レジスタ |
| ADA Handle | ADA Handle | never a bare lowercase "handle" |
| treasury | トレジャリー | Lace's; not 国庫 |
| Max (named in a sentence) | 「最大」 | the button's own label |
| funding (a private session's) | 資金提供 | 入金 is paying into the public account from outside; a site session's top-up is 追加入金 |
| recipient; To (a row label) | 宛先 | 送り先 stays for where freed ADA or rewards go |
| payment key, stake key | 支払鍵, ステーク鍵 | 鍵, never キー (a Plutus map's key is キー) |
| dApps (the page) | dApps ページ | |
| Connected sites | 接続済みのサイト | |
| create a Seedelf; a stealth mint | 作成; ミント | a token mint or burn in a transaction's details is 発行 / 焼却 |
| datum, redeemer, witness | データム, リディーマー, ウィットネス | a redeemer's argument is 引数 |
| transaction ID | トランザクション ID | Lace's word; Lace writes it トランザクションID, and the space is this wallet's, as in DRep を or IPFS ゲートウェイ |
| already | すでに | not 既に |
| a quoted search | 「{{query}}」 | never “ ” |
| route (a swap's) | ルーティング | Lace's; not 配送 |
| Chrome profile | Chrome のプロファイル | Chrome's own term |
| a full tab | 通常のタブ | not 全画面 |
| N waves deep | 深さ N 段 | |
| price (a script spend) | 費用を計算 | |
| Show / Hide | 表示 / 非表示 | Lace's; "Hide X" stays Xを隠す |
| Yes / No / Abstain (a vote) | 賛成 / 反対 / 棄権 | Lace's |
| N boxes | ボックス N 件 | 10 ₳ のボックス N 件 |
| not mixed yet | 未ミックス | not known to be mixed: ミックス未確認 |
| Keep it (a modal's cancel) | そのままにする | |
| your | あなたの, only where it says whose | dropped before 公開アカウント / プライベート残高 |
| IPFS gateway; metadata; Show image (chunk 20) | IPFS ゲートウェイ; メタデータ; 画像を表示 | "either of them could" is どちらか一方だけでも: どちらも can read as the two together |

## How a translation is recorded

Three files beside this one, one set per language:

- **`<lang>-provenance.json`** — how each key's value was produced:
  `human`, `mtpe` (a machine draft checked and corrected value by value: the
  critical keys, by Claude's back-translation, as
  `verified-critical-<lang>.json` names, and a handful of others, chunk 20's
  NFT image messages among them), `exact-reuse` (the English is a name or a
  number and is reused on purpose), `verbatim`, or `machine` for a machine
  draft not checked value by value. The whole-locale review of 2026-10-03
  read every `machine` value that existed then and corrected the ones it
  found wrong without changing their label, so for those `machine` means
  read, not back-translated; a key added since is a draft until someone
  reads it.
- **`verified-critical-<lang>.json`** — the accuracy-critical keys that have
  been back-translated and compared for meaning, and **who did it**.
- **`critical-keys.json`** — which keys are accuracy-critical. Generated from
  the source by `extension/scripts/i18n-critical.mjs`, not written by hand.

`extension/tests/i18n.test.ts` holds all of it together: a critical key whose
provenance is `machine` and which is not listed as verified fails
the build. There is no flag to turn that off.
