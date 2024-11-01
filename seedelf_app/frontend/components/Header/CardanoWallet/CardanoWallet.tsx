import { useEffect, useState } from 'react';
import { useWallet, useWalletList } from '@meshsdk/react';
import { MenuItem } from './MenuItem'; // Adjust according to actual import paths
import { WalletBalance } from './WalletBalance'; // Adjust according to actual import paths
import { Container, Button, Text, Menu } from '@mantine/core';

// Define TypeScript interface for the component props
interface CardanoWalletProps {
  label?: string;
  onConnected?: () => void; // Updated to be a more specific function type
}

export const CardanoWallet = ({
  label = "Connect Wallet",
  onConnected = undefined,
}: CardanoWalletProps) => {
  const wallets = useWalletList({});
  const [hideMenuList, setHideMenuList] = useState<boolean>(true);
  const { wallet, connect, connecting, connected, disconnect, name } = useWallet();

  useEffect(() => {
    if (connected && onConnected) {
      onConnected();
    }
  }, [connected, onConnected]);

  return (
    <Container onMouseEnter={() => setHideMenuList(false)} onMouseLeave={() => setHideMenuList(true)}>

      <Menu
        opened={!hideMenuList}
        onOpen={() => setHideMenuList(false)}
        onClose={() => setHideMenuList(true)}
        trigger="hover"
      >
        <Menu.Target>
          <Button
            onClick={() => setHideMenuList(!hideMenuList)}
          >
            <WalletBalance
              connected={connected}
              connecting={connecting}
              label={label}
              wallet_info={wallets.find((wallet) => wallet.id === name)}
              wallet={wallet}
            />
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          {!connected && wallets.length > 0 ? (
            wallets.map((wallet, index) => (
              <Menu.Item
                key={index}
              >
                <MenuItem
                  icon={wallet.icon}
                  label={wallet.name}
                  action={() => {
                    connect(wallet.id);
                    setHideMenuList(!hideMenuList);
                  }}
                  active={name === wallet.id}
                />
              </Menu.Item>
            ))
          ) : wallets.length === 0 ? (
            <Text>
              No Wallet Found
            </Text>
          ) : (
            <Menu.Item>
              <MenuItem
                icon={undefined}
                label={"Disconnect"}
                action={disconnect}
                active={false}
              />
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    </Container>

  );
};
