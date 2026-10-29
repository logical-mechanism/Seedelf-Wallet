# Smart contracts, privately

A thread on X: how Seedelf Wallet uses a dApp without handing it the private balance, and comes back through Lovejoin. Seven posts, the first six with an image each. Each post fits X's 280 characters (a link counts as 23).

It's written to sell, for someone who wants privacy rather than the maths; the docs keep the limits. Every claim in it is still checked against [flows.md](../../../docs/flows.md#contract-round-trip) and [privacy.md](../../../docs/privacy.md).

## 1 · [01-the-loop.png](01-the-loop.png)

> Ever wondered how Seedelf keeps you private on #Cardano? Let's look inside: how it uses smart contracts without the dApp ever seeing your wallet. 🧵👇

**Alt text:** A diagram titled "Smart contracts, privately". Step 1, Fund: the private balance (your Seedelfs, under stealth registers) pays a one-time account, with fresh keys and its own 5 ₳ collateral. Step 2, Use: the one-time account and the dApp work back and forth; the dApp sees an ordinary wallet. Step 3, Return: everything goes from the one-time account into Lovejoin, mixed with other people's UTxOs. Step 4, Back, mixed: the boxes come back to the private balance. Notes: the dApp gets only a one-time account; its transactions can chain; no contract-to-contract limits.

## 2 · [02-stealth-registers.png](02-stealth-registers.png)

> Your private balance sits at one shared Seedelf contract, beside everyone else's. Every payment to you lands in disguise, so the chain can't tell whose Seedelf was paid, or who spends it.

**Alt text:** A diagram titled "Your private balance": everyone's private money in one place, every payment in disguise. On the left, your Seedelf, the name people pay you at. Every payment goes in disguise into the Seedelf contract, one address shared by everyone, holding twelve UTxOs that all look alike. Three are outlined as yours, and only your key can tell which. Below: every payment in disguise, so the chain can't tell whose Seedelf was paid, or who spends it; and only your key knows, since your wallet finds what's yours and spends it with a proof that never shows your key. A footnote for the curious: re-randomized BLS12-381 registers and Schnorr proofs.

## 3 · [03-the-problem.png](03-the-problem.png)

> Contracts are the hard part. dApps build their transactions for a wallet with keys, and some dApps' contracts refuse a transaction that spends another contract too, a guard against double satisfaction. Your private balance is a contract.

**Alt text:** Titled "Why not pay the dApp directly?": two walls between a private balance and a dApp. Left, dApps build for keys: a transaction the dApp built, with a key's UTxO and its signatures, works; swap a Seedelf UTxO in and its signatures break, and it's refused. Right, dApps refuse other contracts: one transaction holding a dApp contract and a Seedelf UTxO is refused by the dApp's contract, because another contract is spent in it too. Some dApps do this to guard against double satisfaction, and your private balance is a contract.

## 4 · [04-one-time-account.png](04-one-time-account.png)

> So the wallet opens a one-time account: a fresh key account, funded from your private balance with the amount and 5 ₳ of collateral of its own. To the dApp it's an ordinary wallet: no contract-to-contract limits, and its transactions can chain.

**Alt text:** Titled "A one-time account", steps 1 and 2. The private balance funds a one-time account holding the amount and its own 5 ₳ collateral, with fresh keys never used before. It works back and forth with the dApp, which sees an ordinary wallet. Below, transactions 1, 2 and 3 in a chain, each built on the last before it lands. Ticks: an ordinary wallet to the dApp; no contract-to-contract limits; used once, never again.

## 5 · [05-through-lovejoin.png](05-through-lovejoin.png)

> When you're done, it all comes back, through Lovejoin on the way: your UTxOs are mixed with other people's, and each comes back on its own, hours later. ADA and tokens alike, where a pool takes them.

**Alt text:** Titled "Back through Lovejoin", steps 3 and 4. The one-time account returns what the dApp paid back into Lovejoin, a pool of equal boxes. Two of your boxes go in among other people's, are mixed several times, and come out looking alike: which are yours? They come back to the private balance under fresh registers, each on its own, at its own random time, hours later. Ticks: ADA and tokens alike, where a pool takes them; on by default, and yours to turn off.

## 6 · [06-private-again.png](06-private-again.png)

> It lands in your private balance under fresh registers, and the one-time account is never used again. Lovejoin breaks the line on chain from the dApp's account back into your balance.

**Alt text:** Titled "Private again": what someone watching the chain can follow. Brought back directly, a switch away: a solid line from the one-time account to the private balance, and anyone can tie it to the session and its funding. Through Lovejoin, the default: the line from the one-time account reaches Lovejoin, then breaks at a question mark before the private balance; the trail breaks in the pool, and boxes come back mixed, hours apart. Ticks: back under fresh registers; the one-time account is never used again; no two sessions share a key.

## 7 · no image

> Free, open source, no token, and it never asks for your recovery phrase.
>
> https://chromewebstore.google.com/detail/seedelf-wallet/dkefopeefhophfkjkkdebhoklagjdmcp
> Code and bug bounty: github.com/logical-mechanism/Seedelf-Wallet
> Discord: discord.gg/r8VwV2jGBy
