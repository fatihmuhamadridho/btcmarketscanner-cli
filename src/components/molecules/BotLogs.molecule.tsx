import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import type { TerminalHistoryItem } from '@interfaces/terminal.interface';

function tone(kind: TerminalHistoryItem['kind']) {
  if (kind === 'error') return '#ff6b6b';
  if (kind === 'success') return '#50fa7b';
  if (kind === 'system') return '#8be9fd';
  return '#e6edf3';
}

export function BotLogs({ items, width }: { items: TerminalHistoryItem[]; width?: number }) {
  return (
    <Panel title="Bot Logs" width={width}>
      <Box flexDirection="column">
        {items.length === 0 ? (
          <Text dimColor>No bot logs yet. Turn on auto-trade or start the bot.</Text>
        ) : (
          items.slice(-20).map((item, index) => (
            <Text key={`${item.kind}-${index}-${item.message}`}>
              <Text color={tone(item.kind)} bold>
                {item.kind === 'error' ? '!' : item.kind === 'success' ? '+' : '>'}
              </Text>{' '}
              <Text color={tone(item.kind)}>{item.message}</Text>
            </Text>
          ))
        )}
      </Box>
    </Panel>
  );
}
