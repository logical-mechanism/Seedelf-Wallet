import React, { useEffect, useState } from 'react';
import { Container, Text, Progress, Space } from '@mantine/core';
import SeedelfLogo from './SeedelfLogo';
import classes from './Header.module.css';

function Header() {
  const [syncStatus, setSyncStatus] = useState({
    sync_perc: '0.00', // Default percentage
    blocks_behind: -1,   // Default blocks behind
  });

  // Function to calculate the dynamic color based on sync percentage (gradient from red to green, passing through blue)
  const getGradientColor = (percentage: number) => {
    const r = Math.floor(255 * (1 - percentage/100));
    const g = Math.floor(255 * (percentage/100));
    const b = percentage < 50 ? Math.floor(127 * (percentage/100)): Math.floor(127 * (1 - percentage/100));
    // console.log(`rgb(${r}, ${g}, ${b})`);
    // return it as a rpg tuple
    return `rgb(${r}, ${g}, ${b})`;
  };

  useEffect(() => {
    const fetchSyncStatus = async () => {
      try {
        const response = await fetch('http://127.0.0.1:44203/sync_status');
        const data = await response.json();
        setSyncStatus(data);
      } catch (error) {
        console.error('Error fetching sync status:', error);
      }
    };

    // Fetch data initially
    fetchSyncStatus();

    // Set an interval to fetch data every 5 seconds
    const interval = setInterval(() => {
      fetchSyncStatus();
    }, 5000);

    // Clean up the interval when the component unmounts
    return () => clearInterval(interval);
  }, []);

  return (
    <header className={classes.header}>
      <Container className={classes.inner}>
        <SeedelfLogo />
        <Space w="md" />
        <Container fluid>
          <Text size="md" style={{ textAlign: 'center', marginBottom: '6px' }}>
            {syncStatus.blocks_behind < 0 ? (
              'Loading...'
            ) : syncStatus.blocks_behind === 0 ? (
              'Wallet Synced'
            ) : (
              `Sync Status: ${syncStatus.sync_perc}% (${syncStatus.blocks_behind} blocks behind)`
            )}
          </Text>
          {syncStatus.blocks_behind < 0 ? (
              <></>
            ) : (
              <Progress
                value={parseFloat(syncStatus.sync_perc)}
                size="sm"
                radius="sm"
                color={getGradientColor(parseFloat(syncStatus.sync_perc))}
              />
            )}
        </Container>
        <Space w="md" />
      </Container>
    </header>
  );
}

export default Header;
