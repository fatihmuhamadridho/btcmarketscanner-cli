import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.molecule.js';
export function WatchPicker({ items, selectedIndex, query, width, }) {
    if (items.length === 0) {
        return (_jsx(Panel, { title: "Watch Picker", width: width, children: _jsx(Text, { color: "#8b949e", children: "No live market pairs available." }) }));
    }
    const visibleCount = Math.min(10, items.length);
    const maxStartIndex = Math.max(0, items.length - visibleCount);
    const startIndex = Math.min(maxStartIndex, Math.max(0, selectedIndex - Math.floor(visibleCount / 2)));
    const visibleItems = items.slice(startIndex, startIndex + visibleCount);
    const contentWidth = Math.max(0, (width ?? 0) - 4);
    const pairWidth = Math.max(8, contentWidth - 16);
    return (_jsx(Panel, { title: "Watch Picker", width: width, children: _jsxs(Box, { flexDirection: "column", children: [query.length > 0 ? (_jsx(Box, { marginBottom: 0, children: _jsxs(Text, { color: "#8b949e", children: ["filter: ", _jsx(Text, { color: "#8be9fd", children: query })] }) })) : null, visibleItems.map((item, visibleIndex) => {
                    const index = startIndex + visibleIndex;
                    const selected = index === selectedIndex;
                    const labelColor = item.isWatched ? '#50fa7b' : item.isTrading ? '#8be9fd' : '#8b949e';
                    const statusLabel = item.isWatched ? 'watchlisted' : item.isTrading ? 'trading' : 'inactive';
                    const displayPair = item.displayName;
                    const pairValue = displayPair.length > pairWidth ? `${displayPair.slice(0, pairWidth - 1)}…` : displayPair;
                    return (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: 2, marginRight: 1, flexShrink: 0, children: _jsx(Text, { color: selected ? '#8be9fd' : '#8b949e', bold: selected, children: selected ? '>' : ' ' }) }), _jsx(Box, { width: 12, marginRight: 1, flexShrink: 0, children: _jsx(Text, { color: labelColor, bold: selected || item.isWatched, children: item.symbol }) }), _jsx(Box, { flexGrow: 1, flexShrink: 1, children: _jsx(Text, { color: selected ? '#f8f8f2' : '#c9d1d9', children: pairValue }) }), _jsx(Box, { width: 10, marginLeft: 1, flexShrink: 0, children: _jsx(Text, { color: "#f1fa8c", children: item.volumeLabel }) }), _jsx(Box, { width: 12, marginLeft: 1, flexShrink: 0, children: _jsx(Text, { color: item.isWatched ? '#50fa7b' : '#8b949e', children: statusLabel }) })] }, item.symbol));
                }), _jsx(Box, { marginTop: 0, children: _jsxs(Text, { color: "#8b949e", children: ["showing ", startIndex + 1, "-", Math.min(items.length, startIndex + visibleCount), " of ", items.length] }) })] }) }));
}
