import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '../molecules/Panel.molecule.js';
import { formatAvailableCommands } from '../../lib/command-parser.js';

export function HelpOverlay() {
  return (
    <Panel title="Slash Commands" width={84}>
      <Box flexDirection="column">
        {formatAvailableCommands().map((entry) => (
          <Text key={entry.command}>
            <Text color="#7ee7ff">{entry.command}</Text>{' '}
            <Text dimColor>{entry.example ? `${entry.example} ` : ''}</Text>
            <Text>{entry.description}</Text>
          </Text>
        ))}
      </Box>
    </Panel>
  );
}
