
async function initializePage() {
  // get the installed wallets for the user to select
  const cardano = await waitForCardano();
  populateWalletDropdown(cardano);

  // Retrieve dynamic data from the injected script
  const injectedScript = document.getElementById("injected-data");
  const injectedNetworkScript = document.getElementById("injected-network-data");
  const injectedData = JSON.parse(injectedScript.textContent || "{}");
  const injectedNetwork = JSON.parse(injectedNetworkScript.textContent || "");

  // we can change the status with this element
  const statusElement = document.getElementById("status");
  const txLinkElement = document.getElementById("tx_link");

  // we can push tx cbor for easy viewing here
  const txCborElement = document.getElementById("tx_cbor");
  txCborElement.textContent = injectedData.message;

  // the transaction's id, its body's hash, which signing doesn't change: shown
  // before the wallet signs, it's what to look up when a submit isn't confirmed
  const txId = injectedData.id;
  const txUrl = "https://" + injectedNetwork.network + "cardanoscan.io/transaction/" + txId;
  document.getElementById("tx_id").textContent = txId;

  // we need to wait for the wallet, enable it, then sign the injected data
  try {
    const walletObject = await waitForWallet();
    const wallet = await walletObject.enable();

    // we need to make sure that the wallet is actually on the correct network
    const network_int = await wallet.getNetworkId();
    if (injectedNetwork.network === "preprod.") {
      if (network_int !== 0) {
        statusElement.textContent = "Wallet is not using the pre-production network. Please switch to the pre-production network and try again.";
        return;
      }
    } else {
      if (network_int !== 1) {
        statusElement.textContent = "Wallet is not using the mainnet network. Please switch to the mainnet network and try again.";
        return;
      }
    }

    // the wallet should be enabled and on the correct network
    statusElement.textContent = "Wallet connected successfully!";

    let complete_tx;
    try {
      const sig_part = await wallet.signTx(injectedData.message);

      // add the wallet's witnesses to the transaction's own
      complete_tx = withWitnesses(injectedData.message, sig_part);
    } catch (error) {
      // nothing went out
      statusElement.textContent = "Error: Sign Tx Failure. Message: " + words(error) + ".  Refresh page and try again.";
      return;
    }

    // Once the wallet has it, a submit it doesn't confirm may have gone
    // through all the same: look its id up before running the command again,
    // the CLI's own advice for its own submits (chunk 51).
    let unconfirmed;
    try {
      const tx_hash = await wallet.submitTx(complete_tx);
      if (typeof tx_hash !== "string" || tx_hash.toLowerCase() !== txId) {
        unconfirmed = "its answer isn't the transaction's id";
      }
    } catch (error) {
      unconfirmed = words(error);
    }
    txLinkElement.href = txUrl;
    if (unconfirmed !== undefined) {
      txLinkElement.textContent = "Look It Up On Cardanoscan";
      statusElement.textContent = "Transaction " + txId + " may have gone through: the wallet didn't confirm it (" + unconfirmed + "). Look it up on Cardanoscan before you run the command again.";
      return;
    }
    txLinkElement.textContent = "View Transaction On Cardanoscan";

    statusElement.textContent = "Transaction successfully submitted! It will take a few moments to hit the chain. Please close this tab and stop the web server. The transaction can be viewed on Cardanoscan by clicking the View Transaction On Cardanoscan button.";
  } catch (error) {
    statusElement.textContent = "Error: Wallet Not Enable. Message: " + words(error) + ".  Refresh page and try again.";
  }
}

// What an error says. A CIP-30 wallet throws an object holding `info`, not an Error.
function words(error) {
  if (error && typeof error.info === "string") return error.info;
  if (error && typeof error.message === "string") return error.message;
  return String(error);
}

// The transaction is the CBOR array [body, witness set, valid, auxiliary data].
// Its witness set is found by walking that structure, never by searching the
// hex: the body's own bytes (an address, an input's id, a datum) can hold any
// pattern, and a witness spliced there breaks the body the wallet signed
// (chunk 51, r4#3).

function hexBytes(hex) {
  if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error("The transaction isn't hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return bytes;
}

// The head of the CBOR item at `at`: its major type, its length or count
// (undefined when indefinite), and where what follows the head starts.
function cborHead(bytes, at) {
  if (at >= bytes.length) throw new Error("The transaction's CBOR ends early");
  const major = bytes[at] >> 5;
  const info = bytes[at] & 0x1f;
  if (info < 24) return { major, length: info, next: at + 1 };
  if (info <= 27) {
    const size = 2 ** (info - 24);
    if (at + size >= bytes.length) throw new Error("The transaction's CBOR ends early");
    let length = 0;
    for (let i = 1; i <= size; i++) length = length * 256 + bytes[at + i];
    return { major, length, next: at + 1 + size };
  }
  if (info === 31 && major >= 2 && major <= 5) return { major, length: undefined, next: at + 1 };
  throw new Error("The transaction's CBOR can't be read");
}

// Where the CBOR item at `at` ends.
function cborEnd(bytes, at) {
  const { major, length, next } = cborHead(bytes, at);
  // a number, or a simple value or a float, whose bytes the head held
  if (major === 0 || major === 1 || major === 7) return next;
  // a tag, then the item it tags
  if (major === 6) return cborEnd(bytes, next);
  if (length === undefined) {
    // items until a break
    let end = next;
    while (bytes[end] !== 0xff) end = cborEnd(bytes, end);
    return end + 1;
  }
  if (major === 2 || major === 3) {
    if (next + length > bytes.length) throw new Error("The transaction's CBOR ends early");
    return next + length;
  }
  let end = next;
  for (let i = 0; i < (major === 4 ? length : 2 * length); i++) end = cborEnd(bytes, end);
  return end;
}

// The entries of the CBOR map at `at` in `hex`: each its key's hex and the
// whole entry's, and where the map ends.
function mapEntries(hex, bytes, at) {
  const { major, length, next } = cborHead(bytes, at);
  if (major !== 5) throw new Error("A witness set must be a CBOR map");
  const entries = [];
  let end = next;
  while (length === undefined ? bytes[end] !== 0xff : entries.length < length) {
    const keyEnd = cborEnd(bytes, end);
    const entryEnd = cborEnd(bytes, keyEnd);
    entries.push({ key: hex.slice(2 * end, 2 * keyEnd).toLowerCase(), hex: hex.slice(2 * end, 2 * entryEnd) });
    end = entryEnd;
  }
  return { entries, end: length === undefined ? end + 1 : end };
}

// The transaction `unsigned` with the witnesses the wallet's `signTx`
// returned added to its own: one witness set holding both, each kind once
// (the transaction's own kept: its redeemers), in key order.
function withWitnesses(unsigned, signed) {
  const tx = hexBytes(unsigned);
  const top = cborHead(tx, 0);
  if (top.major !== 4 || top.length !== 4) throw new Error("This isn't a transaction");
  const bodyEnd = cborEnd(tx, top.next);
  const ours = mapEntries(unsigned, tx, bodyEnd);
  const theirs = mapEntries(signed, hexBytes(signed), 0);
  const kept = new Set(ours.entries.map((entry) => entry.key));
  const entries = theirs.entries.filter((entry) => !kept.has(entry.key)).concat(ours.entries);
  entries.sort((a, b) => a.key.length - b.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (entries.length > 23) throw new Error("The witness set can't be read");
  const head = (0xa0 + entries.length).toString(16);
  return unsigned.slice(0, 2 * bodyEnd) + head + entries.map((entry) => entry.hex).join("") + unsigned.slice(2 * ours.end);
}

async function waitForWallet() {
  return new Promise((resolve, reject) => {

    let attempts = 0;
    const maxAttempts = 3000;
    let walletName = "";
    let prompted = false;

    const interval = setInterval(async () => {
      if (window.cardano && window.cardano[walletName]) {
        if (await window.cardano[walletName].isEnabled() === true) {
          clearInterval(interval);
          resolve(window.cardano[walletName]);
        } else if (!prompted) {
          prompted = true;
          try {
            clearInterval(interval);
            await window.cardano[walletName].enable();
            waitForWallet().then(resolve).catch(reject);
          } catch (error) {
            // If enabling fails, show a message.
            const statusElement = document.getElementById("status");
            statusElement.textContent = "Please enable wallet for this URL or try a different wallet.";
            reject(new Error(`Please enable ${walletName} for this URL.`));
          }
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        reject(new Error("Wallet not found after waiting."));
      }
      attempts++;

      // we let the user select a wallet to use first
      const walletDropdownElement = document.getElementById("wallet_dropdown");
      walletName = walletDropdownElement.value;

    }, 100);
  });
}

async function waitForCardano() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3000; // Adjust attempts as needed

    const interval = setInterval(() => {
      if (window.cardano && Object.keys(window.cardano).length > 0) {
        clearInterval(interval);
        resolve(window.cardano); // Resolve with the wallets
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        reject(new Error("Cardano wallets not found after waiting."));
      }
      attempts++;
    }, 100); // Check every 100ms
  });
}

function populateWalletDropdown(cardano) {
  // auto populate the dropdown with the installed wallets
  const walletDropdown = document.getElementById('wallet_dropdown');
  // thank you meshjs for this
  const sortedWallets = Object.keys(cardano)
    .sort()  // Sort keys alphabetically
    .reduce((acc, key) => {
      acc[key] = cardano[key];  // Rebuild the object with sorted keys
      return acc;
    }, {});
  for (const key in sortedWallets) {
    try {
      const _wallet = window.cardano[key];
      if (_wallet === undefined) continue;
      if (_wallet.name === undefined) continue;
      if (_wallet.icon === undefined) continue;
      if (_wallet.apiVersion === undefined) continue;

      const option = document.createElement('option');
      option.value = key;
      option.textContent = _wallet.name.charAt(0).toUpperCase() + _wallet.name.slice(1); // Capitalize first letter
      walletDropdown.appendChild(option);
    } catch (e) { }
  }
}

document.addEventListener("DOMContentLoaded", initializePage);
