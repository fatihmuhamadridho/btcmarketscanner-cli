import React from 'react';
import { Box, Text } from 'ink';

export function TradeRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Box justifyContent="space-between">
      <Text color="#8b949e">{label}</Text>
      <Text color={accent ?? '#f5f5f5'} bold>
        {value}
      </Text>
    </Box>
  );
}
