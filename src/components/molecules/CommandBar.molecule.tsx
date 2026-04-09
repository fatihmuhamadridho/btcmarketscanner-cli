import React from 'react';
import { Box, Text } from 'ink';

export function CommandBar({
  value,
  width,
}: {
  value: string;
  width?: number;
}) {
  const placeholder = 'Enter command';
  const hasValue = value.length > 0;
  const shownValue = hasValue ? value.slice(-60) : '';

  return (
    <Box width={width} borderStyle="round" borderColor="#5b5b5b" paddingX={0} paddingY={0} flexDirection="row">
      <Text color="#8be9fd" bold>
        &nbsp;&gt;&nbsp;
      </Text>
      {!hasValue ? (
        <Text color="#c9d1d9">
          <Text backgroundColor="#8be9fd" color="#1f1f1f">
            {placeholder[0]}
          </Text>
          {placeholder.slice(1)}
        </Text>
      ) : (
        <Text color="#c9d1d9">
          {shownValue}
          <Text color="#8be9fd">▌</Text>
        </Text>
      )}
    </Box>
  );
}
