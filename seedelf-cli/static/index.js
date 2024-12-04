async function initializePage() {
    // Retrieve dynamic data from the injected script
    const injectedScript = document.getElementById("injected-data");
    const data = JSON.parse(injectedScript.textContent || "{}");

    // Update the DOM with the injected data
    const statusElement = document.getElementById("status");
    console.log("Dynamic data loaded:", data.message);

    // Example wallet logic (expand as needed)
    try {
        const walletObject = await waitForWallet();
        const wallet = await walletObject.enable();
        statusElement.textContent = "Wallet connected successfully!";
        const sig = await wallet.signTx(data.message, partialSign = true);
        console.log("Wallet Sig:", sig);
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
