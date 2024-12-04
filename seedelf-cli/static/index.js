async function initializePage() {
    // Retrieve dynamic data from the injected script
    const injectedScript = document.getElementById("injected-data");
    const data = JSON.parse(injectedScript.textContent || "{}");
    console.log("Dynamic data loaded:", data.message);

    // we can change the status with this element
    const statusElement = document.getElementById("status");

    // we can push tx cbor for easy viewing here
    const txCborElement = document.getElementById("tx_cbor");
    txCborElement.textContent = data.message;

    // we need to wait for th wallet, enable it, then sign the injected data
    try {
        const walletObject = await waitForWallet();
        const wallet = await walletObject.enable();
        statusElement.textContent = "Wallet connected successfully!";
        const sig = await wallet.signTx(data.message, partialSign = true);
        console.log("Wallet Sig:", sig);
        // do other things here
    } catch (error) {
        console.error("Failed to enable wallet:", error);
        statusElement.textContent = "Failed to connect wallet: " + error.message;
    }
}

async function waitForWallet() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 20;

        const interval = setInterval(() => {
            if (window.cardano && window.cardano.eternl) {
                clearInterval(interval);
                resolve(window.cardano.eternl);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                reject(new Error("Wallet not found after waiting."));
            }
            attempts++;
        }, 100);
    });
}

document.addEventListener("DOMContentLoaded", initializePage);
