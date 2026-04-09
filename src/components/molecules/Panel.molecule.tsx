import React from 'react';
import { Box, Text } from 'ink';

export function Panel({
  title,
  children,
  width,
}: {
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <Box width={width} borderStyle="round" borderColor="#3f3f3f" paddingX={1} paddingY={0} flexDirection="column">
      <Text bold color="#8be9fd">
        {title}
      </Text>
      <Box marginTop={0} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
