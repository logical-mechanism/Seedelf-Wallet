# Translation glossary

The words that must be the same everywhere, so a user reading Spanish or
Japanese meets one wallet rather than three. Checked against **Lace 2.4.2**'s
own `es.json` and `ja.json` (`_reference/lace`) wherever Lace
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
red de pruebas de Cardano"), the name is not. There is no Spanish or Japanese
form of either brand that would make sense.

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
| Receive | Recibir | 受取 | Lace has 受信, "receive a signal"; 受取 is what money does — this wallet parts from Lace here deliberately, as for Home's Send |
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
| the server (what the wallet reads Cardano through and sends to) | el servidor | サーバー | on mainnet the wallet's own data layer answers first, and on preprod Koios does, so a screen names Koios only where Koios alone is meant: Chrome's access to it, the Koios-only switch, Settings' server status, a DRep profile Koios fetches |

## Chosen in the whole-locale review

Unlike the table above, which is settled, these are the words a Claude review
chose when it read every Spanish and Japanese value end to end, each applied
to every key that says it. It decided in this order: this file, then Lace
where Lace says the same thing, then the reviewer, then the majority. The
maintainer may overrule any of them.

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
| retire (a DRep), retirement | retirar tu DRep, retiro de DRep | Lace's "Retiro de DRep", for your own DRep and anyone's; one that has retired "se ha retirado", as a pool has. Never "dar de baja" or "retirarte como DRep". Beside a withdrawal's "retiro", say whose: "Revisar el retiro del DRep" |
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
| IPFS gateway; metadata | pasarela IPFS; metadatos | "gestionada por Blockfrost", never "que gestiona Blockfrost", which reads as the gateway managing Blockfrost |

### Japanese

| English | Japanese | Note |
|---|---|---|
| browser | ブラウザ | Lace's; not ブラウザー |
| register (a Seedelf's) | レジスター | not レジスタ |
| ADA Handle | ADA Handle | never a bare lowercase "handle" |
| treasury | トレジャリー | Lace's; not 国庫 |
| retire (a DRep) | 退任 | Lace's "DRep退任", for your own DRep and anyone's; a stake pool's retirement stays 引退 |
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
| IPFS gateway; metadata; Show image | IPFS ゲートウェイ; メタデータ; 画像を表示 | "either of them could" is どちらか一方だけでも: どちらも can read as the two together |

## Chosen for 1.6.0

Lovejoin's token pools, Bootstrap, the collateral's mix and payments in parts
came in 1.6.0. These are the words their values use, gathered from the notes
of the verified files and checked against this table. Like the section above,
these are Claude's choices, which the maintainer may overrule.

| English | Spanish | Japanese | Note |
|---|---|---|---|
| token pool; ADA pool; the classic pool | pool de token; pool de ADA; el pool clásico | トークンプール; ADA プール; クラシックプール | the classic pool is 1.5.0's 10 ₳ one |
| box value (what each box in a pool holds) | valor de caja | 中身; pools of the same box value: 中身が同じプール | not ボックス額, which reads as an amount of ADA, save for an ADA pool's, which is one (10 ₳ 以外のボックス額) |
| Start a pool; its start | Iniciar un pool; el inicio, or la puesta en marcha | プールを開始; 開始 | what makes the pool. es uses both for a start, and el inicio where starts are counted (ambos inicios, otro inicio); once it's on chain, es says it "está en marcha". Never arranque, which is the Bootstrap |
| Help start (a pool short of its floor); Being started | poner en marcha; Poniéndose en marcha | 立ち上げ; 立ち上げ中 | it can't be mixed in yet: never a bare "En marcha", which says it's running |
| Bootstrap; to bootstrap; Bootstrapping | un arranque; arrancar; Arranque | ブートストラップ; ブートストラップする; ブートストラップ中 | boxes put in with no mix, for others to mix with |
| held (by a Bootstrap); Held (a tag) | retenida(s); Retenida | 保持; 保持中 | an es tag agrees with the mix, as Completada does |
| the floor (the boxes not yours a pool must hold before the wallet mixes) | el mínimo | 下限 | |
| four boxes a mix | cuatro cajas por mezcla | ミックスごとにボックス 4 件 | |
| the pool of 5 ₳ boxes; the collateral's mix | el pool de cajas de 5 ₳; la mezcla del colateral | 5 ₳ ボックスのプール; コラテラルのミックス | never "the 5 ₳ pool", which read as a pool holding 5 ₳ in all |
| in a box of its own (the collateral's, mixed once) | en una caja propia | 専用のボックスで | |
| giveme.my backs (the collateral's mix) | respaldar | 支える | a public account's collateral backing its own mixes, from 1.5.0, is 裏付ける |
| a look (the wallet's search for pools); once a look finds it | una búsqueda; cuando una búsqueda lo encuentra | 検索; 検索で見つかると | |
| a copy (of a pool) | una copia | 複製 | |
| a pool's credential | la credencial | 資格情報 | Lace's, and the transaction details'; not クレデンシャル |
| sent in parts; only partly sent | por partes; enviado solo en parte | 分けて送信; 一部しか送られませんでした | each part is a transaction: トランザクション N 件 |
| settled (a transaction that landed, or now can't) | resolverse | 確定するか、確定できなくなる | 確定 alone says it landed |
| Bring every box back now | Traer todas las cajas de vuelta ahora | すべてのボックスを今すぐ戻す | |
| change (what a transaction gives back) | el cambio | 釣り銭 | Lace has お釣り; おつり, in two values, says the same |
| an amount in ₳ | a no-break space (U+00A0) before ₳ | the same | the house's rule in every language, the English too (usability review V-7) |

## Chosen for 1.8.0

Lovejoin v2 came in 1.8.0, and the pools on Lovejoin's older scripts were
retired: withdraw-only. Like the sections above, these are Claude's choices,
which the maintainer may overrule.

| English | Spanish | Japanese | Note |
|---|---|---|---|
| retired (a Lovejoin pool, its scripts) | los scripts retirados de Lovejoin; los pools retirados | 廃止済みのスクリプト; 廃止されたプール | said of the scripts and the pools that run them, never of Lovejoin, which goes on: "Lovejoin's retired scripts", "the retired pools". es says "retirado" alone: "retiro" is a withdrawal (above), and a pool's boxes are withdrawn from it. A stake pool's retirement keeps "se ha retirado" and 引退, a DRep's "retirar tu DRep" and 退任 |
| Lovejoin's current contracts; its older ones (the store listing) | los contratos actuales de Lovejoin; los contratos anteriores de Lovejoin | Lovejoin の現行のコントラクト; 以前のコントラクト | the listing's words for v2's scripts and the retired ones: it says contracts, as its "Lovejoin's own contracts" does. es names Lovejoin in both, as the listing does: "sus contratos anteriores" could be read as the pools' own |

## Chosen for 1.10.0

Seedelf Messaging came in 1.10.0. These are the words its values use, gathered
by the 1.10.0 gate's review, which found the feature's name and "the other
side" each said three ways in Spanish (i18n#7) and Japanese saying 確認 for
verify where the rest of the wallet says 検証 (i18n#3). Like the sections
above, these are Claude's choices, which the maintainer may overrule.

| English | Spanish | Japanese | Note |
|---|---|---|---|
| Messages (the feature's name) | Mensajes, plural: "Los Mensajes están desactivados" | メッセージ | es says it as a plural throughout, as Home's row's "Desactivados" does |
| a message; a first message | un mensaje; un primer mensaje | メッセージ; 最初のメッセージ | |
| a conversation | una conversación | 会話 | |
| a request (a stranger's first messages, before a reply) | una solicitud | リクエスト | |
| the other side (of a conversation) | la otra parte | 相手 | never el otro lado or la otra persona |
| Unknown sender | Remitente desconocido | 不明な送信者 | |
| show (a Seedelf, the reveal); Show my Seedelf | mostrar; Mostrar mi Seedelf | 見せる; 自分の Seedelf を見せる | the other side's own: 相手が自分の Seedelf を見せました |
| verified; unverified; checking (on the chain) | verificado; sin verificar; comprobándolo | 検証済み; 未検証; 検証中 | ja's 検証, as Minswap's 検証済み; Check on chain is es Comprobar en la cadena, ja チェーン上で検証する |
| your contact | tu contacto | 連絡先, 連絡先の {{name}} | as Send's payee line says it |
| a tag (a Seedelf's) | la etiqueta “{{tag}}” | タグ「{{tag}}」 | as Receive's line says it |
| unread | sin leer | 未読 | |
| this device | este dispositivo | この端末 | never デバイス |
| start again; continue (in a new conversation) | empezar de nuevo; continuar | やり直す; 続き | |
| sent, expires; missing | enviado, caduca; falta | 送信済み、期限切れ; 欠落 | never "delivered" or "expired" (protocol.md §6, §10) |
| dropped (before it was read); couldn't be kept (no room) | descartar: "se descartaron… antes de que se pudieran leer"; no se pudo guardar | 破棄: 読まれる前に破棄されました; 保存できませんでした | the server's gap and the wallet's own backlog both drop; only what had no room says that deleting a conversation makes room |
| this connection (the server's share of reading for the day) | esta conexión; su cuota de lectura del día | この接続; 1 日に読み込める分 | "connection", as the rate limits say it, never "address", which reads as a Cardano address |

## How a translation is recorded

Three files beside this one, one set per language:

- **`<lang>-provenance.json`** — how each key's value was produced:
  `human`, `mtpe` (a machine draft checked and corrected value by value: the
  critical keys, by Claude's back-translation, as
  `verified-critical-<lang>.json` names, and a handful of others, the
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
