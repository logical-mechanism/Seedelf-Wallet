async function initializePage() {
    // Retrieve dynamic data from the injected script
    const injectedScript = document.getElementById("injected-data");
    const injectedNetworkScript = document.getElementById("injected-network-data");
    const data = JSON.parse(injectedScript.textContent || "{}");
    const network = JSON.parse(injectedNetworkScript.textContent || "");
    console.log("Dynamic data loaded:", data.message);
    console.log("Dynamic network loaded:", network.network);

    // we can change the status with this element
    const statusElement = document.getElementById("status");
    const txLinkElement = document.getElementById("tx_link");

    // we can push tx cbor for easy viewing here
    const txCborElement = document.getElementById("tx_cbor");
    txCborElement.textContent = data.message;

    // we need to wait for th wallet, enable it, then sign the injected data
    try {
        const walletObject = await waitForWallet();
        const wallet = await walletObject.enable();
        statusElement.textContent = "Wallet connected successfully!";
        
        const sig_part = await wallet.signTx(data.message);
        console.log("Wallet Sig:", sig_part);
        
        let sig;
        let complete_tx;
        if (data.message.indexOf("a105") === -1) {
            complete_tx = data.message.replace("a0f5f6", sig_part + "f5f6")
        } else {
            // smart contract exists as there is a redeemer
            sig = "a2" + sig_part.slice(2);
            const redeemer_part = data.message.slice(data.message.indexOf("a105"));
            complete_tx = data.message.replace(redeemer_part, sig) + redeemer_part.slice(2);
        }

        console.log("Tx:", complete_tx);
        let tx_hash = await wallet.submitTx(complete_tx);
        console.log("Tx Hash:", tx_hash);
        
        txLinkElement.href = "https://" + network.network + "cardanoscan.io/transaction/" + tx_hash; // Set the href attribute
        txLinkElement.textContent = "View Transaction On Cardanoscan";
        
        statusElement.textContent = "Transaction successfully submitted! Please close this tab and Crtl-C the server in the terminal. The transaction can be viewed on Cardanoscan by clicking the View Transaction On Cardanoscan button.";
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
