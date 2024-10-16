import React from 'react';
import { Container, Grid, Card, Text, Button } from '@mantine/core';

function Body() {
  return (
    <Container fluid>
      <Grid gutter="sm">
        <Grid.Col span={2}>
          <Card shadow="sm" padding="lg">
            <Button fullWidth>Create Account</Button>
            {/* Add content here */}
          </Card>
        </Grid.Col>
        <Grid.Col span={10}>
          <Card shadow="sm" padding="lg">
            <Text size="lg" style={{ textAlign: 'center' }}>
              Account View Here
            </Text>
            {/* Add content here */}
          </Card>
        </Grid.Col>
      </Grid>
    </Container>
  );
}

export default Body;
