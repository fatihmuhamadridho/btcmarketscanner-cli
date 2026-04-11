import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import type { TerminalAllocationUnit } from '@interfaces/terminal.interface';

export function SetupInput({ unit, value, width }: { unit: TerminalAllocationUnit; value: string; width?: number }) {
  return (
    <Panel title="Setup Value" width={width}>
      <Box flexDirection="column">
        <Text dimColor>
          {unit === 'usdt'
            ? 'Type the USDT margin amount to use for entry.'
            : 'Type the wallet percentage to use for entry.'}
        </Text>
        <Text>
          <Text color="#8b949e">value: </Text>
          <Text color="#8be9fd">{value || '|'}</Text>
          <Text color="#f1fa8c">{unit === 'usdt' ? ' USDT' : ' %'}</Text>
        </Text>
        <Text dimColor>Use numbers, "." or "," for decimals, Enter to save, Esc to cancel.</Text>
      </Box>
    </Panel>
  );
}
