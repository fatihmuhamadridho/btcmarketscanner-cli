import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import { SETUP_LEVERAGE_OPTIONS } from '@lib/command-parser';

export function SetupPicker({ selectedIndex, width }: { selectedIndex: number; width?: number }) {
  return (
    <Panel title="Setup Leverage" width={width}>
      <Box flexDirection="column">
        <Text dimColor>Choose a leverage preset for /setup.</Text>
        {SETUP_LEVERAGE_OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Text key={option.leverage}>
              <Text color={isSelected ? '#8be9fd' : '#7ee7ff'} bold={isSelected}>
                {isSelected ? '>' : ' '} {option.leverage}x
              </Text>{' '}
              <Text dimColor>{option.description}</Text>
            </Text>
          );
        })}
        <Text dimColor>Use arrows and Enter. Esc closes the picker.</Text>
      </Box>
    </Panel>
  );
}
