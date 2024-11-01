import React, { useEffect, useState } from 'react';
import { Wallet } from "@meshsdk/common";
import { Container, Image, Text } from '@mantine/core';
import { BrowserWallet, UTxO } from '@meshsdk/core';


export const WalletBalance = ({
  connected,
  connecting,
  label,
  wallet_info,
  wallet,
}: {
  connected: boolean;
  connecting: boolean;
  label: string;
  wallet_info: Wallet | undefined;
  wallet: BrowserWallet;
}) => {
  const [lovelace, setLovelace] = useState<string>("")

  // Function to sum lovelace values in utxos
  const sumLovelace = (utxos: UTxO[]) => {
    return utxos.reduce((acc, utxo) => {
      // Find the lovelace amount in output.amount array
      const lovelaceAmount = utxo.output.amount.find(
        (amount) => amount.unit === 'lovelace'
      );
      // Convert the quantity to a number and add it to the accumulator
      return acc + (lovelaceAmount ? parseInt(lovelaceAmount.quantity, 10) : 0);
    }, 0);
  };

  useEffect(() => {
    setLovelace("")
    const fetchUtxos = async () => {
      try {
        const utxos = await wallet.getUtxos();
        const _lovelace = sumLovelace(utxos).toString();
        setLovelace(_lovelace)
      } catch {
        // console.error('Error fetching sync status:', error);
      }
    };
    if (connected) {
      fetchUtxos();
    }
  }, [connected, wallet]);
  
  return connected && lovelace && wallet_info?.icon ? (
    <Container>
      <Text>₳{" "}{parseInt((parseInt(lovelace, 10) / 1_000_000).toString(), 10)}.{lovelace.substring(lovelace.length - 6)}</Text>
    </Container>
  ) : connected && wallet_info?.icon ? (
    <Container>
      <Image src={wallet_info.icon} h={32} w={32} alt=""></Image>
    </Container>
  ) : connecting ? (
    <Container><Text>Connecting...</Text></Container>
  ) : (
    <Container><Text>{label}</Text></Container>
  );
};