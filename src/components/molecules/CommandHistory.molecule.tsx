import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.molecule.js';
import type { TerminalHistoryItem } from '../../interfaces/terminal.interface.js';

function tone(kind: TerminalHistoryItem['kind']) {
  if (kind === 'error') return '#ff7b72';
  if (kind === 'system') return '#7ee7ff';
  return '#f5f5f5';
}

export function CommandHistory({
  items,
}: {
  items: TerminalHistoryItem[];
}) {
  return (
    <Panel title="Command History" width={84}>
      <Box flexDirection="column">
        {items.slice(-2).map((item, index) => (
          <Text key={`${item.kind}-${index}`}>
            <Text color={tone(item.kind)} bold>
              {item.kind === 'error' ? '!' : '>'}
            </Text>{' '}
            <Text dimColor>{item.input ? `${item.input} ` : ''}</Text>
            <Text color={tone(item.kind)}>{item.message}</Text>
          </Text>
        ))}
      </Box>
    </Panel>
  );
}
