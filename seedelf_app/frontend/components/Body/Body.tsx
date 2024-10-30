import React from 'react';
import { Container, Tabs, Divider } from '@mantine/core';

function Body() {
  return (
    <Container>
      <Divider />
      <Tabs defaultValue="account" onChange={(value) => {console.log("Viewing", value)}}>
        <Tabs.List grow>
          <Tabs.Tab value="account" color="violet">
            Account
          </Tabs.Tab>
          <Tabs.Tab value="send" ml="auto" color="blue">
            Send
          </Tabs.Tab>
          <Tabs.Tab value="history" ml="auto" color="orange">
            History
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="account">
          Show account here
        </Tabs.Panel>

        <Tabs.Panel value="send">
          Send funds here
        </Tabs.Panel>

        <Tabs.Panel value="history">
          show history here
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

export default Body;
