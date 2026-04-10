import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.molecule.js';
function tone(kind) {
    if (kind === 'error')
        return '#ff6b6b';
    if (kind === 'system')
        return '#8be9fd';
    return '#e6edf3';
}
export function CommandHistory({ items, width, }) {
    return (_jsx(Panel, { title: "History", width: width, children: _jsx(Box, { flexDirection: "column", children: items.slice(-2).map((item, index) => (_jsxs(Text, { children: [_jsx(Text, { color: tone(item.kind), bold: true, children: item.kind === 'error' ? '!' : '>' }), ' ', _jsx(Text, { color: "#8b949e", children: item.input ? `${item.input} ` : '' }), _jsx(Text, { color: tone(item.kind), children: item.message })] }, `${item.kind}-${index}`))) }) }));
}
