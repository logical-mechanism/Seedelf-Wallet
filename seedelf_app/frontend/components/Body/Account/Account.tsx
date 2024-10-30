import React, { useEffect, useState } from 'react';

import { Container, Text } from '@mantine/core';

type Seedelf = {
  secret: string;
  tkn: string;
};


function Account() {
  const [seedelfs, setSeedelfs] = useState<Seedelf[]>([]);

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
      <Text>Account View</Text>
      {seedelfs.length === 0 ? (
        // We need to create a seedelf then
        <Text>Empty List</Text>
      ) : (
        // we  need to display the seedelf info
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
