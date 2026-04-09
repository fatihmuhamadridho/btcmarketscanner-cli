import React from 'react';
import { Text } from 'ink';

export function StatLine({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Text>
      <Text color="#8b949e">{label} </Text>
      <Text color={color ?? '#f8f8f2'} bold>
        {value}
      </Text>
    </Text>
  );
}
