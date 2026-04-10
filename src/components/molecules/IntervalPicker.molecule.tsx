import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';

export type IntervalPickerItem = {
  label: string;
  description: string;
  interval: string;
};

export function IntervalPicker({
  items,
  selectedIndex,
  width,
}: {
  items: IntervalPickerItem[];
  selectedIndex: number;
  width?: number;
}) {
  if (items.length === 0) {
    return (
      <Panel title="Interval Picker" width={width}>
        <Text color="#8b949e">No intervals available.</Text>
      </Panel>
    );
  }

  return (
    <Panel title="Interval Picker" width={width}>
      <Box flexDirection="column">
        {items.map((item, index) => {
          const selected = index === selectedIndex;
          return (
            <Box key={item.interval} flexDirection="row">
              <Box width={2} marginRight={1} flexShrink={0}>
                <Text color={selected ? '#8be9fd' : '#8b949e'} bold={selected}>
                  {selected ? '>' : ' '}
                </Text>
              </Box>
              <Box width={8} marginRight={1} flexShrink={0}>
                <Text color={selected ? '#8be9fd' : '#f8f8f2'} bold>
                  {item.label}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={selected ? '#f8f8f2' : '#c9d1d9'}>{item.description}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Panel>
  );
}
