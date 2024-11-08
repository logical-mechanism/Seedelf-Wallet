import React, { useEffect, useState } from 'react';
import { useWallet } from '@meshsdk/react';
import { Container, Text } from '@mantine/core';

type Seedelf = {
  secret: string;
  tkn: string;
};


function Account() {
  const [seedelfs, setSeedelfs] = useState<Seedelf[]>([]);

  const { wallet, connected } = useWallet();

  useEffect(() => {
    const fetchSeedelfs = async () => {
      try {
        const response = await fetch('http://127.0.0.1:44203/getSeedelfs');
        const data = await response.json();
        if (data.seedelfs) {
          setSeedelfs(data.seedelfs);
        }

      } catch (error) {
        console.error('Error fetching sync status:', error);
      }
    };

    fetchSeedelfs();
  });

  return (
    <Container>
      {!connected ? (
        // Show this when not connected
        <Text>Please Connect A Wallet</Text>
      ) : seedelfs.length === 0 ? (
        // Show this when connected but no seedelfs are present
        <Text>Need To Create Seedelf</Text>
      ) : (
        // Show the list when connected and there are seedelfs
        <ul>
          {seedelfs.map((item, index) => (
            <li key={index}>
              Secret: {item.secret}, Token: {item.tkn}
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}

export default Account;
