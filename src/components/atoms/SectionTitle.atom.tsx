import React from 'react';
import { Text } from 'ink';

export function SectionTitle({ text }: { text: string }) {
  return (
    <Text color="#7ee7ff" bold>
      {text}
    </Text>
  );
}
