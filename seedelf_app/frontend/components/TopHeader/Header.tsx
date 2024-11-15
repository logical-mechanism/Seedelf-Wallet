import React, { useEffect, useState } from 'react';
import { Container, Text, Progress, Space } from '@mantine/core';
import SeedelfLogo from './SeedelfLogo';
import classes from './Header.module.css';

function Header() {
  const [syncStatus, setSyncStatus] = useState({
    sync_perc: '0.00', // Default percentage
    blocks_behind: 0,   // Default blocks behind
  });

  // Function to calculate the dynamic color based on sync percentage (gradient from red to green, passing through blue)
  const getGradientColor = (percentage: number) => {
    const r = percentage < 50 ? 255 : Math.floor(510 - 5.1 * percentage); // Red decreases as the percentage increases past 50
    const g = percentage > 50 ? 255 : Math.floor(5.1 * percentage); // Green increases as the percentage increases
    const b = percentage < 50 ? Math.floor(5.1 * percentage) : Math.floor(255 - 5.1 * percentage); // Blue is present until 50%, then decreases

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
      <Container size="lg" className={classes.inner}>
        <SeedelfLogo />
        <Space w="md" />
        <div style={{ width: '100%' }}>
          <Text size="sm" style={{ textAlign: 'center', marginBottom: '10px' }}>
            {syncStatus.blocks_behind === 0 ? (
              'Wallet Synced'
            ) : (
              `Sync Status: ${syncStatus.sync_perc}% (${syncStatus.blocks_behind} blocks behind)`
            )}
          </Text>
          <Progress
            value={parseFloat(syncStatus.sync_perc)}
            size="md"
            radius="sm"
            color={getGradientColor(parseFloat(syncStatus.sync_perc))}
          />
        </div>
        <Space w="md" />
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>Seedelf: A Stealth Wallet</Text>
      </Container>
    </header>
  );
}

export default Header;
