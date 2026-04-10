import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import { SETUP_MENU_OPTIONS } from '@lib/command-parser';

export function SetupMenu({ selectedIndex, width }: { selectedIndex: number; width?: number }) {
  return (
    <Panel title="Setup" width={width}>
      <Box flexDirection="column">
        <Text dimColor>Choose a setup option.</Text>
        {SETUP_MENU_OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Text key={option.key}>
              <Text color={isSelected ? '#8be9fd' : '#7ee7ff'} bold={isSelected}>
                {isSelected ? '>' : ' '} {option.label}
              </Text>{' '}
              <Text dimColor>{option.description}</Text>
            </Text>
          );
        })}
        <Text dimColor>Use arrows and Enter. Esc closes the menu.</Text>
      </Box>
    </Panel>
  );
}
