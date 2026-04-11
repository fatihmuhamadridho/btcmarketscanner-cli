import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';
import { SETUP_ALLOCATION_UNIT_OPTIONS, SETUP_LEVERAGE_OPTIONS } from '@lib/command-parser';
import type { TerminalSetupPickerMode } from '@interfaces/terminal.interface';

export function SetupPicker({
  mode,
  selectedIndex,
  width,
}: {
  mode: TerminalSetupPickerMode;
  selectedIndex: number;
  width?: number;
}) {
  const isLeverageMode = mode === 'leverage';

  return (
    <Panel title={isLeverageMode ? 'Setup Leverage' : 'Entry Allocation'} width={width}>
      <Box flexDirection="column">
        <Text dimColor>
          {isLeverageMode ? 'Choose a leverage preset for /setup.' : 'Choose how entry allocation should be measured.'}
        </Text>
        {isLeverageMode
          ? SETUP_LEVERAGE_OPTIONS.map((option, index) => {
              const isSelected = index === selectedIndex;
              return (
                <Text key={option.leverage}>
                  <Text color={isSelected ? '#8be9fd' : '#7ee7ff'} bold={isSelected}>
                    {isSelected ? '>' : ' '} {option.leverage}x
                  </Text>{' '}
                  <Text dimColor>{option.description}</Text>
                </Text>
              );
            })
          : SETUP_ALLOCATION_UNIT_OPTIONS.map((option, index) => {
              const isSelected = index === selectedIndex;
              return (
                <Text key={option.unit}>
                  <Text color={isSelected ? '#8be9fd' : '#7ee7ff'} bold={isSelected}>
                    {isSelected ? '>' : ' '} {option.label}
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
