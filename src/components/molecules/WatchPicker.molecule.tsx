import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '@components/molecules/Panel.molecule';

export type WatchPickerItem = {
  displayName: string;
  pair: string;
  symbol: string;
  volumeLabel: string;
  isTrading: boolean;
  isWatched: boolean;
};

export function WatchPicker({
  items,
  selectedIndex,
  width,
}: {
  items: WatchPickerItem[];
  selectedIndex: number;
  width?: number;
}) {
  if (items.length === 0) {
    return (
      <Panel title="Watch Picker" width={width}>
        <Text color="#8b949e">No live market pairs available.</Text>
      </Panel>
    );
  }

  const visibleCount = Math.min(10, items.length);
  const maxStartIndex = Math.max(0, items.length - visibleCount);
  const startIndex = Math.min(maxStartIndex, Math.max(0, selectedIndex - Math.floor(visibleCount / 2)));
  const visibleItems = items.slice(startIndex, startIndex + visibleCount);
  const contentWidth = Math.max(0, (width ?? 0) - 4);
  const pairWidth = Math.max(8, contentWidth - 16);

  return (
    <Panel title="Watch Picker" width={width}>
      <Box flexDirection="column">
        {visibleItems.map((item, visibleIndex) => {
          const index = startIndex + visibleIndex;
          const selected = index === selectedIndex;
          const labelColor = item.isWatched ? '#50fa7b' : item.isTrading ? '#8be9fd' : '#8b949e';
          const statusLabel = item.isWatched ? 'watchlisted' : item.isTrading ? 'trading' : 'inactive';
          const displayPair = item.displayName;
          const pairValue = displayPair.length > pairWidth ? `${displayPair.slice(0, pairWidth - 1)}…` : displayPair;

          return (
            <Box key={item.symbol} flexDirection="row">
              <Box width={2} marginRight={1} flexShrink={0}>
                <Text color={selected ? '#8be9fd' : '#8b949e'} bold={selected}>
                  {selected ? '>' : ' '}
                </Text>
              </Box>
              <Box width={12} marginRight={1} flexShrink={0}>
                <Text color={labelColor} bold={selected || item.isWatched}>
                  {item.symbol}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={selected ? '#f8f8f2' : '#c9d1d9'}>{pairValue}</Text>
              </Box>
              <Box width={10} marginLeft={1} flexShrink={0}>
                <Text color="#f1fa8c">{item.volumeLabel}</Text>
              </Box>
              <Box width={12} marginLeft={1} flexShrink={0}>
                <Text color={item.isWatched ? '#50fa7b' : '#8b949e'}>{statusLabel}</Text>
              </Box>
            </Box>
          );
        })}
        <Box marginTop={0}>
          <Text color="#8b949e">
            showing {startIndex + 1}-{Math.min(items.length, startIndex + visibleCount)} of {items.length}
          </Text>
        </Box>
      </Box>
    </Panel>
  );
}
