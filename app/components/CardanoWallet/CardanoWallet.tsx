import { useEffect, useState } from 'react';
import { useWallet, useWalletList } from '@meshsdk/react';
import { MenuItem } from './MenuItem'; // Adjust according to actual import paths
import { WalletBalance } from './WalletBalance'; // Adjust according to actual import paths

// Define TypeScript interface for the component props
interface CardanoWalletProps {
  label?: string;
  onConnected?: () => void; // Updated to be a more specific function type
  isDark?: boolean;
}

export const CardanoWallet: React.FC<CardanoWalletProps> = ({
  label = 'Connect Wallet',
  onConnected,
}) => {
  const wallets = useWalletList();
  const [hideMenuList, setHideMenuList] = useState<boolean>(true);
  const { connect, connecting, connected, disconnect, name } = useWallet();

  useEffect(() => {
    if (connected && onConnected) {
      onConnected();
    }
  }, [connected, onConnected]);

  const bgClass = 'blue-bg dark-text';

  return (
    <div className="w-fit relative" onMouseEnter={() => setHideMenuList(false)} onMouseLeave={() => setHideMenuList(true)}>
  <button
    type="button"
    className={`flex items-center justify-center w-30 px-4 py-2 rounded font-bold ${bgClass}`}
    onClick={() => setHideMenuList(!hideMenuList)}
  >
    <WalletBalance
      name={name}
      connected={connected}
      connecting={connecting}
      label={label}
    />
  </button>
  <div
    className={`absolute rounded text-center w-60 ${bgClass} ${hideMenuList ? 'hidden' : ''}`}
  >
    {!connected && wallets.length > 0 ? (
      <>
        {wallets.map((wallet, index) => (
          <MenuItem
            key={index}
            icon={wallet.icon}
            label={wallet.name}
            action={() => {
              connect(wallet.name);
              setHideMenuList(!hideMenuList);
            }}
            active={name === wallet.name}
          />
        ))}
      </>
    ) : wallets.length === 0 ? (
      <span>No Wallet Found</span>
    ) : (
      <>
        <MenuItem
          active={false}
          label="Disconnect"
          action={disconnect}
          icon={undefined}
        />
      </>
    )}
  </div>
</div>

  );
};
