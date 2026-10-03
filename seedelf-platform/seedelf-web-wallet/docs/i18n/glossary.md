# Translation glossary

The words that must be the same everywhere, so a user reading Spanish or
Japanese meets one wallet rather than three. Checked against **Lace 2.4.2**'s
own `es.json` and `ja.json` (`_reference/lace`, pulled 2026-10-02) wherever Lace
says the same thing, because a Cardano user arriving from Lace should recognise
the word.

## Never translated

**Seedelf**, **Seedelf Wallet**, **Lovejoin**, **Koios**, **Cardanoscan**,
**giveme.my**, **Minswap**, **Preprod**, **ADA Handle**, **UTxO**, **CIP-30**,
**DRep**, **ADA**, **₳**. Seedelf is the name and
`extension/tests/words.test.ts` checks it in every locale.

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
| Receive | Recibir | 受取 | Lace has 受信, "receive a signal"; 受取 is what money does — the one place we part from Lace, deliberately |
| Send | Enviar | 送金 | |
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

## How a translation is recorded

Three files beside this one, one set per language:

- **`<lang>-provenance.json`** — how each key's value was produced:
  `human`, `mtpe` (a machine draft a person corrected), `exact-reuse` (the
  English is a name or a number and is reused on purpose), `verbatim`, or
  `machine` for a raw draft nobody has checked.
- **`verified-critical-<lang>.json`** — the accuracy-critical keys that have
  been back-translated and compared for meaning, and **who did it**.
- **`critical-keys.json`** — which keys are accuracy-critical. Generated from
  the source by `extension/scripts/i18n-critical.mjs`, not written by hand.

`extension/tests/i18n.test.ts` holds all of it together: a critical key whose
provenance is a raw `machine` draft and which is not listed as verified fails
the build. There is no flag to turn that off.
