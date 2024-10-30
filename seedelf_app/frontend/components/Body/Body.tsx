import React from 'react';
import { Container, Tabs, Divider, Text } from '@mantine/core';
import Account from './Account/Account';
import History from './History/History';
import Send from './Send/Send';

function Body() {
  return (
    <Container>
      <br />
      <Divider />
      <Tabs defaultValue="account" onChange={(value) => {console.log("Viewing", value)}}>
        <Tabs.List grow>

          {/* All Account Stuff */}
          <Tabs.Tab value="account" color="violet">
            <Text size="lg" fw={700}>Account</Text>
          </Tabs.Tab>
          {/* All Sending Stuff */}
          <Tabs.Tab value="send" ml="auto" color="blue">
            <Text size="lg" fw={700}>Send</Text>
          </Tabs.Tab>
          {/* All History Stuff */}
          <Tabs.Tab value="history" ml="auto" color="orange">
            <Text size="lg" fw={700}>History</Text>
          </Tabs.Tab>
        </Tabs.List>
        
        {/* All Account Stuff */}
        <Tabs.Panel value="account">
          <Account></Account>
        </Tabs.Panel>
        {/* All Sending Stuff */}
        <Tabs.Panel value="send">
          <Send></Send>
        </Tabs.Panel>
        {/* All History Stuff */}
        <Tabs.Panel value="history">
          <History></History>
        </Tabs.Panel>

      </Tabs>
    </Container>
  );
}

export default Body;
