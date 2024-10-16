import React from 'react';
import { Container } from '@mantine/core';
import Header from '../components/Header/Header';
import Body from '../components/Body/Body';

const Wallet = () => {
  return (
    <Container fluid>
      {/* sync status header */}
      <Header></Header>
      {/* column grid and big space grid */}
      <Body></Body>
    </Container>
  );
};

export default Wallet;
