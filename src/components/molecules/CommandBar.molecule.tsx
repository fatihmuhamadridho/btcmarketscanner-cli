import React from 'react';
import { Box, Text } from 'ink';

export function CommandBar({
  value,
}: {
  value: string;
}) {
  const placeholder = 'Enter order command';
  const hasValue = value.length > 0;

  return (
    <Box
      borderStyle="round"
      borderColor="#5b5b5b"
      paddingX={1}
      paddingY={0}
      flexDirection="row"
    >
      <Text color="#7ee7ff" bold>
        ›
      </Text>
      {!hasValue ? (
        <Text color="#8b949e">
          {' '}
          <Text backgroundColor="#8b949e" color="#1f1f1f">
            {placeholder[0]}
          </Text>
          {placeholder.slice(1)}
        </Text>
      ) : (
        <Text color="#8b949e">
          {' '}
          {value}
          <Text color="#f5f5f5">█</Text>
        </Text>
      )}
    </Box>
  );
}
