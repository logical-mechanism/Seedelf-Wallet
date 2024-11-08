import React from 'react';
import { Container, Flex, Image, Text } from '@mantine/core';

export function MenuItem({
  icon,
  label,
  action,
  active,
}: {
  icon?: string;
  label: string;
  action: () => void;
  active: boolean;
}) {
  return (
    <Container onClick={action} >
      <Flex direction="column" align="center" gap="xs">
        <Image h={32} w={32} src={icon} alt="" />
        <Text>
          {label
          .split(" ")
          .map((word: string) => {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          })
          .join(" ")}
        </Text>
        {active}
      </Flex>
    </Container>
  );
};
