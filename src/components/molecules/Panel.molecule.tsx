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
    <Box width={width} flexDirection="column">
      <Box borderStyle="round" borderColor="#5b5b5b" paddingX={1} paddingY={0}>
        <Text bold>{title}</Text>
      </Box>
      <Box marginTop={-1} paddingX={1} paddingY={0}>
        <Box borderStyle="round" borderColor="#3f3f3f" paddingX={1} paddingY={0} flexDirection="column">
          {children}
        </Box>
      </Box>
    </Box>
  );
}
