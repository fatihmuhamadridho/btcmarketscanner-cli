import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import type { TerminalHistoryItem } from '@interfaces/terminal.interface';

function tone(kind: TerminalHistoryItem['kind']) {
  if (kind === 'error') return '#ff6b6b';
  if (kind === 'system') return '#8be9fd';
  return '#e6edf3';
}

export function CommandHistory({ items, width }: { items: TerminalHistoryItem[]; width?: number }) {
  return (
    <Panel title="History" width={width}>
      <Box flexDirection="column">
        {items.slice(-2).map((item, index) => (
          <Text key={`${item.kind}-${index}`}>
            <Text color={tone(item.kind)} bold>
              {item.kind === 'error' ? '!' : '>'}
            </Text>{' '}
            <Text color="#8b949e">{item.input ? `${item.input} ` : ''}</Text>
            <Text color={tone(item.kind)}>{item.message}</Text>
          </Text>
        ))}
      </Box>
    </Panel>
  );
}
