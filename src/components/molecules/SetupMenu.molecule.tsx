import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import { SETUP_MENU_OPTIONS } from '@lib/command-parser';

export function SetupMenu({
  selectedIndex,
  leverage,
  allocationLabel,
  width,
}: {
  selectedIndex: number;
  leverage: number;
  allocationLabel: string;
  width?: number;
}) {
  return (
    <Panel title="Setup" width={width}>
      <Box flexDirection="column">
        <Text dimColor>Choose a setup option.</Text>
        {SETUP_MENU_OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex;
          const value = option.key === 'leverage' ? `${leverage}x` : allocationLabel;
          return (
            <Text key={option.key}>
              <Text color={isSelected ? '#8be9fd' : '#7ee7ff'} bold={isSelected}>
                {isSelected ? '>' : ' '} {option.label}
              </Text>{' '}
              <Text dimColor>
                {option.description} ({value})
              </Text>
            </Text>
          );
        })}
        <Text dimColor>Use arrows and Enter. Esc closes the menu.</Text>
      </Box>
    </Panel>
  );
}
