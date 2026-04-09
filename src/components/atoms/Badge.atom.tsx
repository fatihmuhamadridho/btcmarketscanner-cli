import React from 'react';
import { Text } from 'ink';

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <Text color={color} bold>
      {label}
    </Text>
  );
}
