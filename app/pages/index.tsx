import type { NextPage } from "next";
import { useWallet } from '@meshsdk/react';
import { serializeBech32Address } from '@meshsdk/mesh-csl';
import { useState, useEffect, useCallback } from "react";
import NavBar from "@/components/nav-bar";
import Notification from "@/components/notification";

const Home: NextPage = () => {
  const { connected, wallet, disconnect } = useWallet();
  const [network, setNetwork] = useState<number>(-1);
  const [notification, setNotification] = useState<string>('');
  const [isLoadingData, setisLoadingData] = useState(false);

  const getNetworkId = useCallback(async () => {
    setisLoadingData(true);

    if (wallet) {
      // get the network and change address from the connected wallet
      const _network = await wallet.getNetworkId();
      const changeAddress = await wallet.getChangeAddress();
      // the change address and public key hashes are set in the session
      sessionStorage.setItem('publicKeyHash', serializeBech32Address(changeAddress).pubKeyHash);
      setNetwork(_network);
      setisLoadingData(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (connected) {
      getNetworkId();
    } else {
      setNetwork(-1);
    }
  }, [connected, getNetworkId]);

  useEffect(() => {
    // when in production change this to zero
    const networkFlag = parseInt(process.env.NEXT_PUBLIC_NETWORK_FLAG!);
    if (network >= 0 && network !== networkFlag) {
      // this needs to display some alert
      const alertMsg = networkFlag === 0 ? 'pre-production' : 'mainnet';
      setNotification(`network must be set to ${alertMsg}`);
      disconnect(); // Automatically disconnect
    }
  }, [network, disconnect]);

  return (
    <div className="flex flex-col lg:w-full min-w-max">
      <NavBar/>
      {connected ? (
        network !== parseInt(process.env.NEXT_PUBLIC_NETWORK_FLAG!) ? (
          <div>
            {isLoadingData ? (
              <div className="flex items-center justify-center h-screen">
                <p className="text-lg font-semibold light-text">Loading Cogno and Thread Data...</p>
              </div>
            ) : (
              <div className="flex flex-col w-full items-center justify-center">
                <p className="text-lg font-semibold light-text">Incorrect Network</p>
              </div>)
            }
          </div>
        ) : network === parseInt(process.env.NEXT_PUBLIC_NETWORK_FLAG!) ? (
          <div className="flex items-center justify-center h-screen">
            <p>wallet here</p>
          </div>
        ) : (
          <div className="text-lg light-text font-semibold ">Network Not Recognized</div>
        )
      ) : (
        <div className="flex h-screen items-center justify-center flex-col light-text text-lg font-semibold ">
          <h1>Connect Your Wallet</h1>
        </div>
      )}
      {notification && <Notification message={notification} onDismiss={() => setNotification('')} />}
    </div>
  );
};

export default Home;
