# Grow the pool (draft)

A thread on X: how Lovejoin mixes inside Seedelf, and three ways anyone can make its crowd bigger. Six posts, the first five with an image each. Each post fits X's 280 characters as X counts them (₳ and each emoji count 2, a link 23).

**A draft:** the images are settled; the posts' text is still being worked on. It's written to sell, for someone who wants privacy rather than the maths, and leaves the limits to the docs. Every claim in it is still checked against [architecture.md](../../../docs/architecture.md#lovejoin), [flows.md](../../../docs/flows.md) and [privacy.md](../../../docs/privacy.md).

## Open before posting

- **Four wide isn't the default.** Image 3 and post 3 show four boxes a mix. The wallet mixes three wide unless "Four boxes a mix" is on in Settings, and goes three wide when four can't be built. Either the post says so ("Four a mix is one switch in Settings") or image 3 goes back to three (two strangers, nine leaves).
- **"Any of sixteen" is about the mixes, never a proof.** Each mix hides its shuffle, so a watcher's odds are 1 in N^k for the mixes on chain. Nothing in seedelf-verification proves it (the proofs say when each contract accepts), and in practice a box hides only among the leaves whose owners also bring them back into a Seedelf around the same time (privacy.md). Never "proven" or "verified" next to it.
- **Kept out:** "the only mixer on Cardano" (unchecked, and it invites replies), "not even the mixer can tell" (false: whoever builds a mix knows its shuffle), anything that sounds like yield (a Bootstrap buys its owner nothing), and a box count (it's boxes, not people, and the crowd that matters is people bringing boxes back).
- **Post 6's optional line** is CLAIMS.md's own short claim, in the owner's measured tone for security posts.

## 1 · [01-the-crowd.png](01-the-crowd.png)

> Cardano has a mixer, and it lives inside Seedelf. It's called Lovejoin: no operator, no custodian, just a contract that hides your ADA in a crowd. Here's how it works, and how you can make that crowd bigger. 🧵👇

**Alt text:** A diagram titled "Hide in the crowd", with the line "Lovejoin, the mixer that lives inside Seedelf". A wide amber pool holds ninety-six identical boxes; one near the bottom right is outlined in teal, labelled "Only you can tell which one is yours". Below: no operator; no custodian; just a contract, and a crowd.

## 2 · [02-in-it-goes.png](02-in-it-goes.png)

> Your ADA goes in as 5 ₳ boxes. Every box is exactly the same size, and each one sits in disguise: only your key can show which boxes are yours. To the chain, the pool is a crowd of lookalikes.

**Alt text:** Step 1, titled "Every box looks the same": your ADA goes in as equal 5 ₳ boxes, each in disguise. Your ADA, from either side or a dApp session's spare, is split into three equal 5 ₳ boxes and goes into Lovejoin's 5 ₳ pool, which holds forty boxes, every one marked 5 ₳. Three of them carry a small teal dot: only your key can show which boxes are yours.

## 3 · [03-the-mix.png](03-the-mix.png)

> Then the mix: one transaction takes your box and three strangers', re-disguises all four, and puts out four new ones. Anyone watching sees four in, four out, and no way to tell which is which. Two waves later, yours could be any of sixteen.

**Alt text:** Step 2, titled "Four in, four out": your box and three strangers', re-disguised together. In wave 1, your box and three strangers' boxes go into one mix, and four alike come out. In wave 2, each of those four goes into its own mix with three more strangers, and sixteen alike come out. A question mark: yours could be any of these sixteen, with strangers picked at random every time.

## 4 · [04-home-alone.png](04-home-alone.png)

> Each box comes back on its own, at its own random time hours later, into your private balance under a fresh disguise. It pays its own way home, so nothing on the way back names your account.

**Alt text:** Step 3, titled "Home on its own time": each box comes back alone, hours apart, under a fresh disguise. Three boxes wait in the Lovejoin pool, then leave one at a time, at 1 h 18 m, 3 h 06 m and 5 h 36 m on a clock from 0 to 6 hours, each into the private balance, under a fresh disguise. Ticks: at its own random time; pays its own way home; nothing on the way back names your account.

## 5 · [05-three-ways.png](05-three-ways.png)

> A mixer is only as strong as its crowd, and every box is cover for everyone else's. Three ways to grow it:
> 1. Just use it: private dApp sessions mix their spare ADA by default.
> 2. Mix from the Lovejoin tile, from either side.
> 3. Bootstrap: put boxes in as cover for others.

**Alt text:** Titled "Three ways to grow the pool", all of them in Seedelf Wallet. One, just use it: private dApp sessions send their spare ADA through the pool, by default. Two, mix: from the Lovejoin tile, from your private balance or your public account. Three, Bootstrap, highlighted: put boxes in as cover for others; they stay yours, and come back when you say.

## 6 · no image

> It's free, open source, and on Cardano mainnet today.
>
> Wallet: https://chromewebstore.google.com/detail/seedelf-wallet/dkefopeefhophfkjkkdebhoklagjdmcp
> Discord: discord.gg/r8VwV2jGBy

Optional, in the owner's tone: "Lovejoin v2's contracts are formally verified on their deployed bytes", linking [CLAIMS.md](../../../../../seedelf-verification/CLAIMS.md).
